import React, { useState, useEffect } from 'react';
import { 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  Sparkles, 
  Search, 
  Film, 
  Tv, 
  Radio, 
  CheckCircle2, 
  Clock, 
  Magnet, 
  Check, 
  Plus, 
  Filter, 
  Layers,
  ArrowRight,
  Star,
  RefreshCw,
  HardDrive
} from 'lucide-react';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useToast } from '../ui/Toast';

interface CalendarDropItem {
  id: string;
  tmdbId?: number;
  title: string;
  episodeCode?: string;
  episodeTitle?: string;
  year: number;
  type: string;
  category: string;
  poster?: string;
  backdrop?: string;
  overview?: string;
  airDate: string;
  status: 'available' | 'airing_today' | 'upcoming';
  countdownText: string;
  seeders?: number;
  topQuality?: string;
  qualities?: string[];
  magnetUrl?: string;
  inWatchlist: boolean;
  groupKey: string;
  originCountry?: string;
}

interface CalendarDayGroup {
  date: string;
  dayOfWeek: string;
  shortDay: string;
  formattedDate: string;
  isToday: boolean;
  isPast: boolean;
  isFuture: boolean;
  drops: CalendarDropItem[];
}

interface DropCalendarViewProps {
  onSelectMedia: (groupKey: string) => void;
}

export default function DropCalendarView({ onSelectMedia }: DropCalendarViewProps) {
  const [scheduleData, setScheduleData] = useState<{
    today: string;
    startDate: string;
    endDate: string;
    days: CalendarDayGroup[];
    totalDrops: number;
    todayDropsCount: number;
    availableCount: number;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [viewMode, setViewMode] = useState<'matrix' | 'timeline'>('matrix');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDayDate, setSelectedDayDate] = useState<string | null>(null);
  const { addToast } = useToast();

  const fetchCalendar = () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('category', selectedCategory);
    if (watchlistOnly) params.set('watchlistOnly', 'true');
    params.set('daysPast', '2');
    params.set('daysAhead', '12');

    fetch(`/api/calendar?${params.toString()}`)
      .then(res => res.json())
      .then(data => {
        setScheduleData(data);
        if (!selectedDayDate && data.today) {
          setSelectedDayDate(data.today);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchCalendar();
  }, [selectedCategory, watchlistOnly]);

  const handleCopyMagnet = (e: React.MouseEvent, drop: CalendarDropItem) => {
    e.stopPropagation();
    if (!drop.magnetUrl) return;

    navigator.clipboard.writeText(drop.magnetUrl);
    setCopiedId(drop.id);
    addToast({
      title: 'Magnet Link Copied!',
      description: `Copied magnet link for "${drop.title}${drop.episodeCode ? ' ' + drop.episodeCode : ''}".`,
      variant: 'success'
    });
    setTimeout(() => setCopiedId(null), 2500);
  };

  const handleToggleWatchlist = async (e: React.MouseEvent, drop: CalendarDropItem) => {
    e.stopPropagation();
    if (togglingId === drop.id) return;

    setTogglingId(drop.id);
    try {
      if (drop.inWatchlist) {
        // Remove from watchlist
        const res = await fetch(`/api/watchlist/${encodeURIComponent(drop.title)}`, { method: 'DELETE' });
        if (res.ok) {
          addToast({
            title: 'Removed from Watchlist',
            description: `"${drop.title}" will no longer send alerts.`,
            variant: 'default'
          });
          updateDropWatchlistState(drop.title, false);
        }
      } else {
        // Add to watchlist
        const res = await fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: drop.title,
            year: drop.year,
            type: drop.type === 'Movie' ? 'Movie' : 'Series',
            category: drop.category
          })
        });
        if (res.ok) {
          addToast({
            title: 'Added to Watchlist!',
            description: `Now monitoring "${drop.title}" for all new torrent drops.`,
            variant: 'success'
          });
          updateDropWatchlistState(drop.title, true);
        }
      }
    } catch (e: any) {
      addToast({
        title: 'Error',
        description: e.message || 'Failed to update watchlist',
        variant: 'error'
      });
    } finally {
      setTogglingId(null);
    }
  };

  const updateDropWatchlistState = (title: string, inWatchlist: boolean) => {
    setScheduleData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        days: prev.days.map(d => ({
          ...d,
          drops: d.drops.map(item => item.title.toLowerCase() === title.toLowerCase() ? { ...item, inWatchlist } : item)
        }))
      };
    });
  };

  const categories = ['All', 'Series', 'Movies', 'Anime', 'Animation'];

  if (loading && !scheduleData) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="h-24 bg-white rounded-3xl border border-gray-100" />
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-4">
          {[1, 2, 3, 4, 5, 6, 7].map(i => (
            <div key={i} className="h-64 bg-white rounded-2xl border border-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  const days = scheduleData?.days || [];
  const todayGroup = days.find(d => d.isToday);
  const selectedDay = days.find(d => d.date === selectedDayDate) || todayGroup || days[0];

  // Filter drops by search query
  const filterDrops = (dropList: CalendarDropItem[]) => {
    if (!searchQuery) return dropList;
    const q = searchQuery.toLowerCase();
    return dropList.filter(d => 
      d.title.toLowerCase().includes(q) || 
      (d.episodeCode && d.episodeCode.toLowerCase().includes(q)) ||
      (d.category && d.category.toLowerCase().includes(q))
    );
  };

  return (
    <div className="space-y-8 pb-16">
      {/* Top Banner Header */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/20">
              <CalendarIcon className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                Drop Calendar & Airing Schedule
              </h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Track exact air dates for new episodes and theatrical releases matched against live torrent availability.
              </p>
            </div>
          </div>
        </div>

        {/* Live Metrics Pills */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="px-4 py-2 bg-gray-50 rounded-2xl border border-gray-100 flex items-center gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Today's Drops</div>
              <div className="text-sm font-bold text-gray-900">{scheduleData?.todayDropsCount || 0} Scheduled</div>
            </div>
          </div>

          <div className="px-4 py-2 bg-emerald-50/70 rounded-2xl border border-emerald-100 flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Torrents Ready</div>
              <div className="text-sm font-bold text-emerald-900">{scheduleData?.availableCount || 0} Verified Available</div>
            </div>
          </div>

          <button
            onClick={fetchCalendar}
            disabled={loading}
            className="p-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors cursor-pointer"
            title="Refresh Airing Schedule"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filter and View Controls Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-gray-100 shadow-xs">
        {/* Category Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full no-scrollbar">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
            >
              {cat}
            </button>
          ))}

          <button
            onClick={() => setWatchlistOnly(!watchlistOnly)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer border ${
              watchlistOnly
                ? 'bg-amber-500 text-white border-amber-600 shadow-xs'
                : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
            }`}
          >
            ★ Watchlist Only
          </button>
        </div>

        {/* Search & Layout toggle */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Filter titles or episodes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
            />
          </div>

          <div className="flex items-center bg-gray-100 p-1 rounded-xl shrink-0">
            <button
              onClick={() => setViewMode('matrix')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                viewMode === 'matrix' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Matrix
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                viewMode === 'timeline' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Timeline
            </button>
          </div>
        </div>
      </div>

      {/* MATRIX VIEW */}
      {viewMode === 'matrix' && (
        <div className="space-y-6">
          {/* Day Selector Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 lg:grid-cols-7 gap-3">
            {days.map(day => {
              const drops = filterDrops(day.drops);
              const isSelected = (selectedDayDate || scheduleData?.today) === day.date;
              const availableCountInDay = drops.filter(d => d.status === 'available').length;

              return (
                <button
                  key={day.date}
                  onClick={() => setSelectedDayDate(day.date)}
                  className={`p-3.5 rounded-2xl border text-left transition-all duration-200 cursor-pointer flex flex-col justify-between relative ${
                    isSelected
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-md ring-2 ring-indigo-600/20'
                      : day.isToday
                      ? 'bg-amber-50/70 border-amber-300 hover:border-amber-400 text-gray-900'
                      : 'bg-white border-gray-100 hover:border-gray-300 text-gray-900'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1">
                      <span className={`text-[11px] font-bold uppercase tracking-wider ${isSelected ? 'text-indigo-200' : 'text-gray-400'}`}>
                        {day.shortDay}
                      </span>
                      {day.isToday && (
                        <span className={`text-[10px] font-extrabold px-1.5 py-0.2 rounded-full ${
                          isSelected ? 'bg-white text-indigo-700' : 'bg-amber-500 text-white'
                        }`}>
                          TODAY
                        </span>
                      )}
                    </div>
                    <div className="text-base font-bold mt-1">
                      {day.formattedDate}
                    </div>
                  </div>

                  <div className="mt-3 pt-2 border-t border-current/10 flex items-center justify-between text-[11px]">
                    <span className={isSelected ? 'text-indigo-100' : 'text-gray-500'}>
                      {drops.length} {drops.length === 1 ? 'drop' : 'drops'}
                    </span>
                    {availableCountInDay > 0 && (
                      <span className={`font-semibold ${isSelected ? 'text-emerald-200' : 'text-emerald-600'}`}>
                        {availableCountInDay} Ready
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Active Day Detail Cards */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-gray-200 pb-3">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-bold text-gray-900">
                  {selectedDay.dayOfWeek}, {selectedDay.formattedDate}
                </h3>
                {selectedDay.isToday && (
                  <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 animate-pulse">
                    Today's Airing Window
                  </span>
                )}
              </div>
              <span className="text-xs text-gray-500">
                {filterDrops(selectedDay.drops).length} releases scheduled
              </span>
            </div>

            {filterDrops(selectedDay.drops).length === 0 ? (
              <div className="text-center py-16 bg-white rounded-3xl border border-gray-100 border-dashed">
                <CalendarIcon className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <h4 className="text-sm font-semibold text-gray-800">No drops scheduled on this day</h4>
                <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                  Try switching categories or select another day to see upcoming releases.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {filterDrops(selectedDay.drops).map(drop => (
                  <DropCard 
                    key={drop.id} 
                    drop={drop} 
                    onSelectMedia={onSelectMedia}
                    onCopyMagnet={handleCopyMagnet}
                    onToggleWatchlist={handleToggleWatchlist}
                    copiedId={copiedId}
                    togglingId={togglingId}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TIMELINE VIEW */}
      {viewMode === 'timeline' && (
        <div className="space-y-8">
          {days.map(day => {
            const drops = filterDrops(day.drops);
            if (drops.length === 0) return null;

            return (
              <div key={day.date} className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${day.isToday ? 'bg-amber-500 ring-4 ring-amber-200' : 'bg-gray-300'}`} />
                  <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                    {day.dayOfWeek}, {day.formattedDate}
                    {day.isToday && (
                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-500 text-white">
                        TODAY
                      </span>
                    )}
                  </h3>
                  <div className="flex-1 h-px bg-gray-200/80" />
                  <span className="text-xs text-gray-500">{drops.length} drops</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {drops.map(drop => (
                    <DropCard 
                      key={drop.id} 
                      drop={drop} 
                      onSelectMedia={onSelectMedia}
                      onCopyMagnet={handleCopyMagnet}
                      onToggleWatchlist={handleToggleWatchlist}
                      copiedId={copiedId}
                      togglingId={togglingId}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Single Drop Card Component in Calendar
interface DropCardProps {
  key?: React.Key;
  drop: CalendarDropItem;
  onSelectMedia: (key: string) => void;
  onCopyMagnet: (e: React.MouseEvent, drop: CalendarDropItem) => void;
  onToggleWatchlist: (e: React.MouseEvent, drop: CalendarDropItem) => void;
  copiedId: string | null;
  togglingId: string | null;
}

function DropCard({
  drop,
  onSelectMedia,
  onCopyMagnet,
  onToggleWatchlist,
  copiedId,
  togglingId
}: DropCardProps) {
  return (
    <Card 
      onClick={() => onSelectMedia(drop.groupKey)}
      className="rounded-2xl border-gray-100 overflow-hidden flex flex-col hover:shadow-lg hover:border-indigo-200 transition-all duration-300 group cursor-pointer relative bg-white"
    >
      {/* Poster Image */}
      <div className="relative aspect-2/3 w-full bg-gray-100 overflow-hidden">
        {drop.poster ? (
          <img 
            src={drop.poster} 
            alt={drop.title} 
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-slate-900 text-white">
            <Film className="w-10 h-10 mb-2 opacity-40 text-indigo-400" />
            <span className="font-bold text-xs">{drop.title}</span>
            <span className="text-[10px] text-gray-400 mt-1">{drop.year}</span>
          </div>
        )}

        {/* Top Badges */}
        <div className="absolute top-2.5 inset-x-2.5 flex items-center justify-between gap-1 z-10">
          <Badge variant="outline" className="bg-black/60 backdrop-blur-md text-white border-white/20 text-[10px]">
            {drop.category || drop.type}
          </Badge>

          {drop.episodeCode && (
            <Badge variant="outline" className="bg-indigo-600/90 backdrop-blur-md text-white border-transparent text-[10px] font-mono font-bold shadow-xs">
              {drop.episodeCode}
            </Badge>
          )}
        </div>

        {/* Status Indicator Bar at Bottom of Poster */}
        <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between gap-1 z-10">
          {drop.status === 'available' ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600/95 text-white backdrop-blur-md shadow-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-200 animate-pulse" />
              <span>Available {drop.seeders ? `• ${drop.seeders.toLocaleString()}s` : ''}</span>
            </span>
          ) : drop.status === 'airing_today' ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/95 text-white backdrop-blur-md shadow-xs">
              <Radio className="w-2.5 h-2.5 animate-pulse" />
              <span>Airing Today</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-900/80 text-gray-200 backdrop-blur-md">
              <Clock className="w-2.5 h-2.5 text-gray-400" />
              <span>{drop.countdownText}</span>
            </span>
          )}

          {drop.topQuality && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/60 text-indigo-200 backdrop-blur-md">
              {drop.topQuality}
            </span>
          )}
        </div>
      </div>

      {/* Card Body */}
      <CardContent className="p-4 flex-1 flex flex-col justify-between space-y-3">
        <div>
          <h3 className="font-bold text-gray-900 text-sm line-clamp-1 group-hover:text-indigo-600 transition-colors" title={drop.title}>
            {drop.title}
          </h3>
          <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
            <span>{drop.year}</span>
            <span>•</span>
            <span className="truncate max-w-[130px]">{drop.countdownText}</span>
          </div>

          {drop.overview && (
            <p className="text-xs text-gray-600 line-clamp-2 mt-2 leading-relaxed">
              {drop.overview}
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div 
          className="pt-2 border-t border-gray-100 flex items-center gap-2 relative z-20"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Watchlist Toggle Button */}
          <button
            type="button"
            onClick={(e) => onToggleWatchlist(e, drop)}
            disabled={togglingId === drop.id}
            className={`flex-1 rounded-xl text-xs font-semibold flex items-center justify-center h-8 transition-all gap-1 cursor-pointer ${
              drop.inWatchlist
                ? 'bg-emerald-50 hover:bg-rose-50 text-emerald-700 hover:text-rose-700 border border-emerald-200'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
            title={drop.inWatchlist ? 'Monitored in Watchlist. Click to remove.' : 'Add to Watchlist for drop alerts'}
          >
            {drop.inWatchlist ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span>Monitored</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                <span>Watchlist</span>
              </>
            )}
          </button>

          {/* Quick Magnet Download Button (if available) */}
          {drop.status === 'available' && drop.magnetUrl && (
            <button
              type="button"
              onClick={(e) => onCopyMagnet(e, drop)}
              className="px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-semibold flex items-center justify-center h-8 transition-colors cursor-pointer shadow-xs gap-1"
              title="Copy verified torrent magnet"
            >
              {copiedId === drop.id ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-300" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Magnet className="w-3.5 h-3.5" />
                  <span>Magnet</span>
                </>
              )}
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
