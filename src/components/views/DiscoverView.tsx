import React, { useState, useEffect } from 'react';
import { format, isToday, isYesterday } from 'date-fns';
import { 
  Sparkles, 
  Search, 
  Plus, 
  Check, 
  RefreshCw, 
  Magnet, 
  Star, 
  Calendar, 
  Film, 
  ChevronRight,
  Trash2,
  HardDrive
} from 'lucide-react';
import { Card, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';

interface DiscoveredRelease {
  id: number;
  tmdbId: number;
  title: string;
  year: number;
  type: string;
  category: string;
  originCountry: string;
  poster?: string;
  backdrop?: string;
  overview?: string;
  voteAverage?: string;
  releaseDate?: string;
  genres?: string;
  downloads?: any[];
  topSeeds: number;
  inWatchlist: boolean;
  downloadsCount: number;
  createdAt: string;
}

interface DiscoverViewProps {
  onSelectMedia?: (groupKey: string) => void;
}

function parseLocalDate(dateStr?: string): Date {
  if (!dateStr) return new Date();
  if (dateStr.includes('T')) return new Date(dateStr);
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    return new Date(y, m, d, 12, 0, 0); // Noon local prevents timezone boundary shifts
  }
  return new Date(dateStr);
}

export default function DiscoverView({ onSelectMedia }: DiscoverViewProps) {
  const [items, setItems] = useState<DiscoveredRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [addingId, setAddingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const { addToast } = useToast();

  const fetchDiscovered = () => {
    const url = `/api/discover?category=${encodeURIComponent(selectedCategory)}&search=${encodeURIComponent(search)}`;
    fetch(url)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          // Strictly only items that have download magnets
          const valid = data.filter(d => d.downloadsCount > 0);
          setItems(valid);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchDiscovered();
  }, [selectedCategory, search]);

  const handleScanDrops = async () => {
    setScanning(true);
    addToast({
      title: 'Scanning TMDB & Torrents',
      description: "Checking TMDB for today's airing episodes & fresh movies, searching torrent indexers every 10m...",
      variant: 'default'
    });

    try {
      const res = await fetch('/api/discover/scan', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        addToast({
          title: 'Scan Complete',
          description: `Discovered ${data.discoveredCount} release(s) with torrent magnets ready. ${data.queuedCount || 0} tracked in queue.`,
          variant: 'success'
        });
        fetchDiscovered();
      } else {
        addToast({
          title: 'Scan Issue',
          description: data.error || 'Failed to scan releases',
          variant: 'error'
        });
      }
    } catch (e: any) {
      addToast({
        title: 'Network Error',
        description: e.message || 'Failed to complete scan',
        variant: 'error'
      });
    } finally {
      setScanning(false);
    }
  };

  const handleAddToWatchlist = async (e: React.MouseEvent, item: DiscoveredRelease) => {
    e.stopPropagation();
    if (addingId === item.id) return;

    setAddingId(item.id);
    try {
      const res = await fetch('/api/discover/add-to-watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const nextInWatchlist = !!data.inWatchlist;
        if (nextInWatchlist) {
          addToast({
            title: 'Added to Watchlist!',
            description: `"${item.title} (${item.year})" is now actively monitored. Telegram alerts enabled for future drops.`,
            variant: 'success'
          });
        } else {
          addToast({
            title: 'Removed from Watchlist',
            description: `"${item.title} (${item.year})" was removed from your watchlist.`,
            variant: 'default'
          });
        }
        setItems(prev => prev.map(d => (d.id === item.id || d.title.toLowerCase() === item.title.toLowerCase()) ? { ...d, inWatchlist: nextInWatchlist } : d));
      } else {
        addToast({
          title: 'Could Not Update',
          description: data.error || 'Failed to update watchlist',
          variant: 'error'
        });
      }
    } catch (e: any) {
      addToast({
        title: 'Error',
        description: e.message || 'Network error updating watchlist',
        variant: 'error'
      });
    } finally {
      setAddingId(null);
    }
  };

  const handleDeleteDrop = async (e: React.MouseEvent, item: DiscoveredRelease) => {
    e.stopPropagation();
    if (deletingId === item.id) return;

    setDeletingId(item.id);
    try {
      const res = await fetch(`/api/discover/${item.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) {
        addToast({
          title: 'Card Deleted',
          description: `Removed "${item.title}" from Discover New Drops.`,
          variant: 'success'
        });
        setItems(prev => prev.filter(d => d.id !== item.id));
      } else {
        addToast({
          title: 'Delete Failed',
          description: data.error || 'Could not delete release card',
          variant: 'error'
        });
      }
    } catch (err: any) {
      addToast({
        title: 'Error',
        description: err.message,
        variant: 'error'
      });
    } finally {
      setDeletingId(null);
    }
  };

  const handleCardClick = (item: DiscoveredRelease) => {
    const key = `discover_${item.id}`;
    if (onSelectMedia) {
      onSelectMedia(key);
    } else {
      window.location.hash = `#/media/${encodeURIComponent(key)}`;
    }
  };

  const categories = ['All', 'Movies', 'Series', 'Animation', 'Anime', 'Documentaries'];

  // Group discovered items by date with safe timezone parsing
  const groupedByDate = items.reduce((acc, item) => {
    const dateObj = parseLocalDate(item.releaseDate || item.createdAt);

    let key = 'Earlier';
    if (isToday(dateObj)) {
      key = 'Today';
    } else if (isYesterday(dateObj)) {
      key = 'Yesterday';
    } else {
      key = format(dateObj, 'MMMM d, yyyy');
    }

    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {} as Record<string, DiscoveredRelease[]>);

  // Chronological sort: Today first, then Yesterday, then newest dates
  const rawDateKeys = Object.keys(groupedByDate);
  const sortedDateKeys = rawDateKeys.sort((a, b) => {
    if (a === 'Today') return -1;
    if (b === 'Today') return 1;
    if (a === 'Yesterday') return -1;
    if (b === 'Yesterday') return 1;
    if (a === 'Earlier') return 1;
    if (b === 'Earlier') return -1;
    return new Date(b).getTime() - new Date(a).getTime();
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500 pb-16">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-gradient-to-br from-indigo-600 to-purple-600 text-white rounded-xl shadow-md shadow-indigo-600/20">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
                Discover New Drops
                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-semibold">
                  ⚡ Today's Airing Episodes & Fresh Movies
                </Badge>
              </h2>
              <p className="text-gray-500 text-sm mt-0.5">
                Episodes airing today & fresh new releases actively monitored every 10 minutes. Only verified torrent magnets are shown. No ended series.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="#/calendar"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-semibold transition-colors cursor-pointer"
            title="View full airing schedule and countdowns"
          >
            <Calendar className="w-3.5 h-3.5 text-indigo-600" />
            <span>Drop Calendar</span>
          </a>

          <Button
            onClick={handleScanDrops}
            disabled={scanning}
            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-sm text-xs font-semibold gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Scanning TMDB & Torrents...' : 'Scan for New Drops'}
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-white p-3 rounded-2xl border border-gray-100 shadow-2xs">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                selectedCategory === cat 
                  ? 'bg-indigo-600 text-white shadow-xs' 
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="relative sm:w-72">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search discovered releases..."
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
          />
        </div>
      </div>

      {/* Discovered Cards Grouped by Date */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
            <Skeleton key={i} className="h-96 w-full rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="rounded-2xl border-dashed border-2 border-gray-200 bg-gray-50/50 p-12 text-center">
          <CardContent className="space-y-4 max-w-md mx-auto">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
              <Sparkles className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-gray-900">No Verified Discovered Releases Yet</h3>
            <p className="text-xs text-gray-500 leading-relaxed">
              Click <strong>"Scan for New Drops"</strong> above to check TMDB for today's airing episodes (like Slow Horses, anime, etc.) and freshly dropped movies, and search torrent indexers!
            </p>
            <Button
              onClick={handleScanDrops}
              disabled={scanning}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Scan TMDB & Torrents
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-10">
          {sortedDateKeys.map(dateKey => {
            const dateItems = groupedByDate[dateKey];
            if (!dateItems || dateItems.length === 0) return null;

            return (
              <div key={dateKey} className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-indigo-600" />
                    <h3 className="text-lg font-bold text-gray-900 tracking-tight">
                      {dateKey}
                    </h3>
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                    {dateItems.length} {dateItems.length === 1 ? 'title' : 'titles'}
                  </span>
                  <div className="h-px bg-gray-200/70 flex-1" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {dateItems.map(item => {
                    const downloads = Array.isArray(item.downloads) ? item.downloads : [];

                    return (
                      <Card 
                        key={item.id} 
                        onClick={() => handleCardClick(item)}
                        className="rounded-2xl border-gray-100 overflow-hidden flex flex-col hover:shadow-lg hover:border-indigo-200/80 transition-all duration-300 group cursor-pointer relative"
                      >
                        {/* Poster Container */}
                        <div className="relative aspect-2/3 w-full bg-gray-100 overflow-hidden">
                          {item.poster ? (
                            <img 
                              src={item.poster} 
                              alt={item.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-gradient-to-br from-indigo-900 to-gray-900 text-white">
                              <Film className="w-10 h-10 mb-2 opacity-50" />
                              <span className="font-bold text-sm leading-tight">{item.title}</span>
                              <span className="text-xs text-gray-400 mt-1">{item.year}</span>
                            </div>
                          )}

                          {/* Hover Overlay */}
                          <div className="absolute inset-0 bg-gradient-to-t from-gray-950/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4">
                            <span className="text-xs font-semibold text-white flex items-center gap-1">
                              Open Detailed Page <ChevronRight className="w-3.5 h-3.5" />
                            </span>
                          </div>

                          {/* Top Badges */}
                          <div className="absolute top-2.5 inset-x-2.5 flex items-center justify-between gap-1">
                            <Badge variant="outline" className="bg-black/60 backdrop-blur-md text-white border-white/20 text-[10px]">
                              {item.category || item.type}
                            </Badge>
                            {item.voteAverage && item.voteAverage !== 'N/A' && (
                              <Badge variant="outline" className="bg-amber-500/90 text-white border-transparent text-[10px] flex items-center gap-1 font-bold shadow-xs">
                                <Star className="w-3 h-3 fill-white" />
                                {item.voteAverage}
                              </Badge>
                            )}
                          </div>

                          {/* Seeders & Size indicator */}
                          <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 flex-wrap">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600/90 text-white backdrop-blur-md">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
                              {downloads.length} {downloads.length === 1 ? 'Quality' : 'Qualities'} • {item.topSeeds} Seeds
                            </span>
                            {downloads[0]?.sizeText && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-900/80 text-sky-200 border border-sky-400/30 backdrop-blur-md">
                                <HardDrive className="w-2.5 h-2.5 text-sky-300" />
                                {downloads[0].sizeText}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Card Content */}
                        <CardContent className="p-4 flex-1 flex flex-col justify-between space-y-3">
                          <div>
                            <h3 className="font-bold text-gray-900 text-sm line-clamp-1 group-hover:text-indigo-600 transition-colors" title={item.title}>
                              {item.title}
                            </h3>
                            <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                              <span>{item.year}</span>
                              <span>•</span>
                              <span className="truncate max-w-[140px]">{item.genres || 'Feature'}</span>
                            </div>

                            {item.overview && (
                              <p className="text-xs text-gray-600 line-clamp-2 mt-2 leading-relaxed">
                                {item.overview}
                              </p>
                            )}
                          </div>

                          {/* Action Buttons */}
                          <div 
                            className="pt-2 border-t border-gray-100 flex items-center gap-2 relative z-20"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {/* 1-Click Add / Remove Watchlist Toggle Button */}
                            {item.inWatchlist ? (
                              <button
                                type="button"
                                onClick={(e) => handleAddToWatchlist(e, item)}
                                disabled={addingId === item.id}
                                className="flex-1 rounded-xl bg-emerald-50 hover:bg-rose-50 text-emerald-700 hover:text-rose-700 border border-emerald-200 hover:border-rose-300 text-xs font-semibold flex items-center justify-center h-8 transition-all group/btn gap-1 shadow-2xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Currently monitored in Watchlist. Click to remove."
                              >
                                {addingId === item.id ? (
                                  <>
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                                    <span>Updating...</span>
                                  </>
                                ) : (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-600 group-hover/btn:hidden" />
                                    <Trash2 className="w-3.5 h-3.5 text-rose-600 hidden group-hover/btn:inline" />
                                    <span className="group-hover/btn:hidden">In Watchlist</span>
                                    <span className="hidden group-hover/btn:inline">Remove</span>
                                  </>
                                )}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => handleAddToWatchlist(e, item)}
                                disabled={addingId === item.id}
                                className="flex-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-semibold flex items-center justify-center h-8 shadow-sm gap-1 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Add to Watchlist for continuous monitoring and Telegram alerts"
                              >
                                {addingId === item.id ? (
                                  <>
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    <span>Adding...</span>
                                  </>
                                ) : (
                                  <>
                                    <Plus className="w-3.5 h-3.5" />
                                    <span>+ Watchlist</span>
                                  </>
                                )}
                              </button>
                            )}

                            {/* Details Button */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCardClick(item);
                              }}
                              className="rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold flex items-center justify-center h-8 px-2.5 shrink-0 transition-colors cursor-pointer shadow-2xs"
                              title="View all download versions & magnets"
                            >
                              <Magnet className="w-3.5 h-3.5 text-indigo-600 mr-1" />
                              Details
                            </button>

                            {/* Delete Drop Button */}
                            <button
                              type="button"
                              onClick={(e) => handleDeleteDrop(e, item)}
                              disabled={deletingId === item.id}
                              className="rounded-xl border border-gray-200 bg-white hover:bg-rose-50 text-gray-400 hover:text-rose-600 text-xs font-semibold flex items-center justify-center h-8 w-8 shrink-0 transition-colors cursor-pointer shadow-2xs"
                              title="Delete this release card"
                            >
                              {deletingId === item.id ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-500" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
