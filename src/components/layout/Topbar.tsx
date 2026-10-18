import React, { useState, useEffect, useRef } from 'react';
import { 
  Menu, 
  Search, 
  RefreshCw, 
  Clock, 
  X, 
  Loader2, 
  Plus, 
  Check, 
  Film, 
  Tv, 
  Star,
  ExternalLink,
  ChevronRight
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useToast } from '../ui/Toast';

interface TopbarProps {
  onMenuClick: () => void;
  lastScan: string | null;
  scanInterval: number;
  onSelectMedia?: (groupKey: string) => void;
  onNavigate?: (view: string) => void;
}

interface SearchItem {
  id?: number | string;
  title: string;
  year: number;
  type: string;
  category?: string;
  poster?: string;
  overview?: string;
  voteAverage?: number;
  topSeeds?: number;
  downloadsCount?: number;
  groupKey?: string;
  inWatchlist?: boolean;
}

export default function Topbar({ 
  onMenuClick, 
  lastScan, 
  scanInterval, 
  onSelectMedia, 
  onNavigate 
}: TopbarProps) {
  const { addToast, toast } = useToast();
  const [isScanning, setIsScanning] = useState(false);

  // Search state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [addingTitle, setAddingTitle] = useState<string | null>(null);
  const [watchlistTitles, setWatchlistTitles] = useState<Set<string>>(new Set());
  
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load watchlist titles once for instant status badges
  const loadWatchlist = () => {
    fetch('/api/watchlist')
      .then(res => res.json())
      .then(items => {
        if (Array.isArray(items)) {
          const titles = new Set<string>(items.map((w: any) => (w.title || '').toLowerCase().trim()));
          setWatchlistTitles(titles);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadWatchlist();
    const handleWlUpdate = () => loadWatchlist();
    window.addEventListener('watchlist-updated', handleWlUpdate);
    return () => window.removeEventListener('watchlist-updated', handleWlUpdate);
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search when user types names
  useEffect(() => {
    const q = query.trim();
    if (!q || q.length < 2) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const timeout = setTimeout(async () => {
      try {
        // Query both local discovered releases and TMDB media catalog in parallel
        const [discRes, mediaRes] = await Promise.all([
          fetch(`/api/discover?search=${encodeURIComponent(q)}`).then(r => r.json()).catch(() => []),
          fetch(`/api/media/search?query=${encodeURIComponent(q)}`).then(r => r.json()).catch(() => [])
        ]);

        const combined: SearchItem[] = [];
        const seenKeys = new Set<string>();

        // 1. Prioritize local discovered items with verified downloads & seeds
        if (Array.isArray(discRes)) {
          for (const d of discRes) {
            const key = `${(d.title || '').toLowerCase().trim()}_${d.year}`;
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              const dls = Array.isArray(d.downloads) ? d.downloads : [];
              combined.push({
                id: d.id,
                title: d.title,
                year: d.year,
                type: d.category || d.type || 'Series',
                category: d.category,
                poster: d.poster,
                overview: d.overview,
                voteAverage: d.voteAverage,
                topSeeds: d.topSeeds || (dls[0]?.seeders || 0),
                downloadsCount: dls.length,
                groupKey: `discover_${d.id}`,
                inWatchlist: watchlistTitles.has((d.title || '').toLowerCase().trim())
              });
            }
          }
        }

        // 2. Append TMDB catalog results
        if (Array.isArray(mediaRes)) {
          for (const m of mediaRes) {
            const key = `${(m.title || '').toLowerCase().trim()}_${m.year}`;
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              combined.push({
                title: m.title,
                year: m.year,
                type: m.type || 'Movie',
                category: m.type,
                poster: m.poster,
                overview: m.overview,
                voteAverage: m.voteAverage,
                groupKey: `${m.title}_${m.year}`,
                inWatchlist: watchlistTitles.has((m.title || '').toLowerCase().trim())
              });
            }
          }
        }

        setResults(combined.slice(0, 8));
        setIsOpen(true);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setIsLoading(false);
      }
    }, 280);

    return () => clearTimeout(timeout);
  }, [query, watchlistTitles]);

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleSelectItem = (item: SearchItem) => {
    setIsOpen(false);
    if (onSelectMedia && item.groupKey) {
      onSelectMedia(item.groupKey);
    } else if (onNavigate) {
      onNavigate('discover');
    }
  };

  const handleAddToWatchlist = async (e: React.MouseEvent, item: SearchItem) => {
    e.stopPropagation();
    if (addingTitle === item.title) return;

    setAddingTitle(item.title);
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.title,
          year: item.year,
          type: item.type === 'Movie' ? 'Movie' : 'Series',
          category: item.category || item.type
        })
      });

      if (res.ok) {
        setWatchlistTitles(prev => new Set([...prev, item.title.toLowerCase().trim()]));
        addToast({
          title: 'Added to Watchlist!',
          description: `"${item.title}" is now monitored. Scanning torrent indexers immediately...`,
          variant: 'success'
        });
        window.dispatchEvent(new Event('watchlist-updated'));
        window.dispatchEvent(new Event('scan-triggered'));
      } else {
        const errData = await res.json().catch(() => ({}));
        addToast({
          title: 'Notice',
          description: errData.error || 'Already in watchlist or could not be added',
          variant: 'default'
        });
      }
    } catch (e: any) {
      addToast({
        title: 'Error',
        description: e.message || 'Failed to add to watchlist',
        variant: 'error'
      });
    } finally {
      setAddingTitle(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (e.key === 'Enter') {
      if (results.length > 0) {
        handleSelectItem(results[0]);
      } else if (onNavigate) {
        onNavigate('discover');
        setIsOpen(false);
      }
    }
  };

  const triggerScan = async () => {
    if (isScanning) return;
    setIsScanning(true);
    toast('Manual scan triggered in background', 'default');
    try {
      await fetch('/api/scan', { method: 'POST' });
      setTimeout(() => {
        window.dispatchEvent(new Event('scan-triggered'));
      }, 1500);
    } catch (e) {
      toast('Failed to trigger scan', 'error');
    } finally {
      setTimeout(() => setIsScanning(false), 2000);
    }
  };

  return (
    <header className="h-16 bg-white/80 backdrop-blur-md border-b border-gray-200/60 sticky top-0 z-30 flex items-center justify-between px-4 sm:px-8">
      <div className="flex items-center gap-4">
        <button 
          onClick={onMenuClick}
          className="lg:hidden p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-lg cursor-pointer"
          aria-label="Toggle menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-full text-xs font-medium text-gray-600">
          <Clock className="w-3.5 h-3.5 text-gray-400" />
          Last Scan: {lastScan ? formatDistanceToNow(new Date(lastScan), { addSuffix: true }) : 'Never'} 
          <span className="text-gray-300 mx-1">|</span>
          Interval: {scanInterval}m
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Interactive Search Bar with Live Results Dropdown */}
        <div ref={searchContainerRef} className="relative w-64 sm:w-80 md:w-96">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input 
              ref={inputRef}
              type="text" 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => { if (results.length > 0) setIsOpen(true); }}
              onKeyDown={handleKeyDown}
              placeholder="Search releases, movies, anime..." 
              aria-label="Search releases"
              className="w-full pl-9 pr-9 py-2 bg-gray-50 border border-gray-200 rounded-full text-sm text-gray-900 placeholder:text-gray-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all shadow-xs"
            />
            {isLoading ? (
              <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-indigo-600 animate-spin" />
            ) : query ? (
              <button
                type="button"
                onClick={handleClear}
                className="w-5 h-5 absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 rounded-full flex items-center justify-center cursor-pointer"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : null}
          </div>

          {/* Live Search Results Dropdown Menu */}
          {isOpen && (query.trim().length >= 2) && (
            <div className="absolute top-full mt-2 right-0 left-0 sm:left-auto sm:w-96 md:w-[420px] bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 p-2 max-h-[460px] overflow-y-auto no-scrollbar animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="px-3 py-1.5 flex items-center justify-between text-[11px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100 mb-1">
                <span>Matching Titles ({results.length})</span>
                <span className="text-[10px] text-gray-400 lowercase font-normal">Press Enter to select</span>
              </div>

              {results.length === 0 && !isLoading ? (
                <div className="p-6 text-center text-xs text-gray-500">
                  No releases found for "{query}".
                  <div className="mt-2">
                    <button
                      onClick={() => {
                        if (onNavigate) onNavigate('discover');
                        setIsOpen(false);
                      }}
                      className="px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors cursor-pointer"
                    >
                      Search all indexers in Discover →
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  {results.map((item, idx) => {
                    const isInWl = item.inWatchlist || watchlistTitles.has(item.title.toLowerCase().trim());
                    const isAdding = addingTitle === item.title;

                    return (
                      <div
                        key={`${item.title}_${item.year}_${idx}`}
                        onClick={() => handleSelectItem(item)}
                        className="p-2.5 rounded-xl hover:bg-gray-50/80 transition-all cursor-pointer flex items-center gap-3 group border border-transparent hover:border-gray-100"
                      >
                        {/* Poster or Icon */}
                        <div className="w-10 h-14 bg-gray-100 rounded-lg overflow-hidden shrink-0 border border-gray-200/60 flex items-center justify-center">
                          {item.poster ? (
                            <img 
                              src={item.poster} 
                              alt={item.title} 
                              className="w-full h-full object-cover" 
                              loading="lazy" 
                            />
                          ) : item.type === 'Movie' ? (
                            <Film className="w-4 h-4 text-gray-400" />
                          ) : (
                            <Tv className="w-4 h-4 text-gray-400" />
                          )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h4 className="text-xs font-bold text-gray-900 truncate group-hover:text-indigo-600 transition-colors">
                              {item.title}
                            </h4>
                            <span className="text-[10px] text-gray-400 shrink-0 font-medium">
                              ({item.year})
                            </span>
                          </div>

                          <div className="flex items-center gap-2 mt-1">
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-gray-100 text-gray-600">
                              {item.type}
                            </span>
                            
                            {item.topSeeds ? (
                              <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                {item.topSeeds.toLocaleString()} seeds
                              </span>
                            ) : null}

                            {item.voteAverage ? (
                              <span className="text-[10px] text-amber-500 font-semibold flex items-center gap-0.5">
                                <Star className="w-2.5 h-2.5 fill-current" />
                                {item.voteAverage}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        {/* Quick Actions */}
                        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          {isInWl ? (
                            <span className="px-2 py-1 rounded-lg bg-amber-50 text-amber-700 text-[10px] font-semibold flex items-center gap-1 border border-amber-200/60">
                              <Check className="w-3 h-3 text-amber-600" />
                              Watchlist
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => handleAddToWatchlist(e, item)}
                              disabled={isAdding}
                              className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-600 text-indigo-600 hover:text-white text-[10px] font-semibold transition-all flex items-center gap-1 border border-indigo-200/60 cursor-pointer shadow-2xs"
                              title="Add to Watchlist & Auto-Sync"
                            >
                              {isAdding ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Plus className="w-3 h-3" />
                              )}
                              Monitor
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleSelectItem(item)}
                            className="p-1 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                            title="View details"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Scan Button */}
        <button 
          onClick={triggerScan}
          disabled={isScanning}
          aria-label="Trigger manual scan"
          className={`p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors group cursor-pointer ${isScanning ? 'opacity-50 cursor-not-allowed' : ''}`}
          title="Trigger Indexer Scan"
        >
          <RefreshCw className={`w-5 h-5 transition-transform duration-500 ${isScanning ? 'animate-spin text-indigo-600' : 'group-hover:rotate-180'}`} />
        </button>
      </div>
    </header>
  );
}
