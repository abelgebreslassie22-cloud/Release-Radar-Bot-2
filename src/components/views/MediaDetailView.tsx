import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, Star, Calendar, Clock, Film, ExternalLink, Copy, Check, 
  Layers, Globe, Search, Share2, Sparkles, AlertCircle,
  ArrowUpDown, Zap, ShieldCheck, Trash2, Plus, ArrowUp, ArrowDown,
  Tv, ListFilter, HardDrive, RefreshCw
} from 'lucide-react';
import { groupReleases, MediaGroup, ReleaseItem } from '../../utils/mediaGrouper';
import { detectSeasonPack } from '../../utils/seasonPack';
import { parseEpisodeInfo, ParsedEpisode } from '../../utils/episodeParser';
import { Badge } from '../ui/Badge';
import { useToast } from '../ui/Toast';
import { Skeleton } from '../ui/Skeleton';
import { ConfirmModal } from '../ui/ConfirmModal';
import { formatDistanceToNow } from 'date-fns';
import EpisodeProgressTracker from '../series/EpisodeProgressTracker';

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

function extractSizeFromText(text?: string): string | null {
  if (!text) return null;
  const match = text.match(/[\(\[\s](\d+(?:\.\d+)?\s*(?:GB|MB|GiB|MiB|TB|kb))[\)\]\s]/i) 
    || text.match(/\b(\d+(?:\.\d+)?\s*(?:GB|MB|GiB|MiB|TB))\b/i);
  return match ? match[1].trim() : null;
}

function getReleaseSize(rel: ReleaseItem): string | null {
  if (rel.metadataJson?.sizeText && typeof rel.metadataJson.sizeText === 'string' && rel.metadataJson.sizeText.trim()) {
    return rel.metadataJson.sizeText.trim();
  }
  if (rel.metadataJson?.sizeBytes && typeof rel.metadataJson.sizeBytes === 'number' && rel.metadataJson.sizeBytes > 0) {
    return formatBytes(rel.metadataJson.sizeBytes);
  }
  const fromType = extractSizeFromText(rel.releaseType);
  if (fromType) return fromType;

  const fromTitle = extractSizeFromText(rel.title);
  if (fromTitle) return fromTitle;

  return null;
}

interface MediaDetailViewProps {
  groupKey: string;
  onBack: () => void;
  sourceView?: string;
}

export default function MediaDetailView({ groupKey, onBack, sourceView }: MediaDetailViewProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<MediaGroup | null>(null);
  const [discoveredItem, setDiscoveredItem] = useState<any>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const getBackLabel = () => {
    if (sourceView === 'calendar') return 'Back to Drop Calendar';
    if (groupKey.startsWith('discover_') || discoveredItem) return 'Back to Discover New Drops';
    return 'Back to Recent Releases';
  };
  const [addingToWatchlist, setAddingToWatchlist] = useState(false);
  const [detailTab, setDetailTab] = useState<'releases' | 'episodes'>('releases');

  // Sorting state (Name, Date, Episode, Quality) with Ascending / Descending
  const [sortBy, setSortBy] = useState<'episode' | 'quality' | 'date' | 'name'>('episode');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [groupByEpisode, setGroupByEpisode] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [qualityFilter, setQualityFilter] = useState<string>('all');
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    type: 'all' | 'single';
    releaseId?: number;
    releaseLabel?: string;
    sourceUrl?: string;
    releaseTitle?: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setLoading(true);

    // 1. Check if this is a discovered release from Discover tab (e.g. discover_12)
    if (groupKey.startsWith('discover_')) {
      const discId = parseInt(groupKey.replace('discover_', ''), 10);
      fetch(`/api/discover/${discId}`)
        .then(res => res.json())
        .then(disc => {
          if (disc && !disc.error) {
            setDiscoveredItem(disc);
            const downloads = Array.isArray(disc.downloads) ? disc.downloads : [];
            const releasesList: ReleaseItem[] = downloads.map((dl: any, idx: number) => {
              const sizeStr = dl.sizeText || (dl.sizeBytes ? formatBytes(dl.sizeBytes) : '') || extractSizeFromText(dl.title || '') || '';
              return {
                id: 900000 + idx,
                title: dl.title || `${disc.title} ${dl.quality || 'WEB-DL'}`,
                year: disc.year,
                type: disc.category || disc.type,
                provider: 'Download Availability Radar',
                sourceUrl: dl.magnetUrl || dl.sourceUrl || '',
                releaseType: sizeStr ? `${dl.quality || 'WEB-DL'} (${sizeStr})` : (dl.quality || 'WEB-DL'),
                seeders: dl.seeders || 0,
                leechers: dl.leechers || 0,
                poster: disc.poster,
                metadataJson: {
                  sizeText: sizeStr,
                  sizeBytes: dl.sizeBytes,
                  magnetUrl: dl.magnetUrl,
                  genres: disc.genres,
                  overview: disc.overview,
                  releaseDate: disc.releaseDate
                },
                createdAt: dl.uploadedAt || disc.createdAt || new Date().toISOString()
              };
            });

            const createdGroup: MediaGroup = {
              groupKey,
              canonicalTitle: disc.title,
              year: disc.year,
              type: disc.category || disc.type,
              poster: disc.poster,
              metadata: {
                overview: disc.overview,
                genres: disc.genres,
                imdbRating: disc.voteAverage ? `${disc.voteAverage}/10` : undefined,
                releaseDate: disc.releaseDate,
                country: disc.originCountry || 'United States'
              },
              latestCreatedAt: disc.createdAt || new Date().toISOString(),
              releases: releasesList,
              availableQualities: Array.from(new Set(downloads.map((d: any) => d.quality).filter(Boolean))),
              topSeeders: disc.topSeeds || 0,
              totalSeeders: downloads.reduce((acc: number, d: any) => acc + (d.seeders || 0), 0),
              totalLeechers: downloads.reduce((acc: number, d: any) => acc + (d.leechers || 0), 0)
            };
            setGroup(createdGroup);
          }
          setLoading(false);
        })
        .catch(() => setLoading(false));
      return;
    }

    // 2. Standard watchlist releases
    fetch('/api/releases')
      .then(res => res.json())
      .then((data: ReleaseItem[]) => {
        if (Array.isArray(data)) {
          const groups = groupReleases(data);
          const found = groups.find(g => g.groupKey === groupKey);
          setGroup(found || null);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [groupKey]);

  const handleCopyReleaseLink = (release: ReleaseItem) => {
    if (release.sourceUrl) {
      navigator.clipboard.writeText(release.sourceUrl);
      setCopiedId(release.id);
      toast('Source URL copied to clipboard!', 'success');
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const handleCopyPageLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    toast('Direct movie page URL copied!', 'success');
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleToggleDiscoveredWatchlist = async () => {
    if (!discoveredItem) return;
    setAddingToWatchlist(true);
    try {
      const res = await fetch('/api/discover/add-to-watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: discoveredItem.id })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.inWatchlist) {
          toast(`Added "${discoveredItem.title}" to monitored Watchlist!`, 'success');
          setDiscoveredItem((prev: any) => ({ ...prev, inWatchlist: true }));
        } else {
          toast(`Removed "${discoveredItem.title}" from Watchlist.`, 'success');
          setDiscoveredItem((prev: any) => ({ ...prev, inWatchlist: false }));
        }
      } else {
        toast(data.error || 'Failed to update watchlist', 'error');
      }
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setAddingToWatchlist(false);
    }
  };

  const handleOpenDeleteAll = () => {
    setDeleteConfirm({
      isOpen: true,
      type: 'all',
    });
  };

  const handleOpenDeleteSingle = (release: ReleaseItem) => {
    setDeleteConfirm({
      isOpen: true,
      type: 'single',
      releaseId: release.id,
      releaseLabel: release.releaseType || release.title,
      sourceUrl: release.sourceUrl,
      releaseTitle: release.title,
    });
  };

  const handleConfirmDelete = async () => {
    if (!group || !deleteConfirm) return;
    setIsDeleting(true);

    if (deleteConfirm.type === 'all') {
      try {
        const ids = group.releases.map(r => r.id);
        const res = await fetch('/api/releases/delete-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            ids,
            dbReleaseIds: group.dbReleaseIds,
            canonicalTitle: group.canonicalTitle,
            groupKey: group.groupKey,
            rawTitles: group.releases.map(r => r.title)
          }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          toast(`Deleted all releases for "${group.canonicalTitle}"`, 'success');
          onBack();
        } else {
          toast(data.error || 'Failed to delete releases', 'error');
        }
      } catch (err: any) {
        toast('Error deleting releases', 'error');
      } finally {
        setIsDeleting(false);
        setDeleteConfirm(null);
      }
    } else if (deleteConfirm.type === 'single') {
      try {
        const res = await fetch('/api/releases/delete-single', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: deleteConfirm.releaseId,
            title: deleteConfirm.releaseTitle || deleteConfirm.releaseLabel,
            sourceUrl: deleteConfirm.sourceUrl,
            seriesTitle: group.canonicalTitle,
            groupKey: group.groupKey,
          }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          const epNotice = data.unnotifiedEpisode 
            ? ` (Un-notified ${data.unnotifiedEpisode} so the real episode can notify later)` 
            : '';
          toast(`Permanently deleted & blacklisted "${deleteConfirm.releaseTitle || deleteConfirm.releaseLabel}". It will not ever appear again${epNotice}!`, 'success');
          setGroup(prev => {
            if (!prev) return null;
            const updated = prev.releases.filter(r => {
              if (deleteConfirm.releaseId && r.id === deleteConfirm.releaseId) return false;
              if (deleteConfirm.sourceUrl && r.sourceUrl && r.sourceUrl === deleteConfirm.sourceUrl) return false;
              if (deleteConfirm.releaseTitle && r.title === deleteConfirm.releaseTitle) return false;
              return true;
            });
            if (updated.length === 0) {
              onBack();
              return null;
            }
            return { ...prev, releases: updated };
          });
        } else {
          toast(data.error || 'Failed to delete release', 'error');
        }
      } catch (err: any) {
        toast('Error deleting release', 'error');
      } finally {
        setIsDeleting(false);
        setDeleteConfirm(null);
      }
    }
  };

  if (loading) {
    return (
      <div className="space-y-8 animate-in fade-in duration-300">
        <Skeleton className="h-10 w-32 rounded-xl" />
        <Skeleton className="h-96 w-full rounded-3xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="text-center py-24 space-y-4">
        <div className="w-16 h-16 rounded-3xl bg-gray-100 flex items-center justify-center mx-auto text-gray-400">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900">Title Not Found</h2>
        <p className="text-gray-500 max-w-sm mx-auto text-sm">
          The requested release group could not be found or may have been deleted.
        </p>
        <button
          onClick={onBack}
          className="mt-4 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-colors shadow-sm cursor-pointer"
        >
          {getBackLabel()}
        </button>
      </div>
    );
  }

  const metadata = group.metadata || {};
  const isSeriesOrTV = /series|tv|anime|animation|show/i.test(group.type || '') ||
    /series|tv|anime|animation|show/i.test(discoveredItem?.type || '') ||
    /series|tv|anime|animation|show/i.test(discoveredItem?.category || '') ||
    group.releases.some(r => /s\d{1,2}e\d{1,2}|\d{1,2}x\d{1,2}|season|episode/i.test(r.title));

  // Construct Search Engine Links
  const letterboxdUrl = `https://letterboxd.com/search/${encodeURIComponent(group.canonicalTitle)}/`;
  const rottenTomatoesUrl = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(group.canonicalTitle)}`;
  const imdbSearchUrl = `https://www.imdb.com/find/?q=${encodeURIComponent(group.canonicalTitle)}`;
  const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(group.canonicalTitle + ' ' + group.year + ' movie review')}`;

  const getQualityBadgeColor = (typeText: string) => {
    const text = typeText.toLowerCase();
    if (text.includes('4k') || text.includes('2160p')) return 'bg-purple-100 text-purple-800 border-purple-200';
    if (text.includes('1080p')) return 'bg-indigo-100 text-indigo-800 border-indigo-200';
    if (text.includes('720p')) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (text.includes('bluray')) return 'bg-blue-100 text-blue-800 border-blue-200';
    return 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const qualityCounts = {
    all: group.releases.length,
    '4k': group.releases.filter(r => /2160p|4k|uhd/i.test(r.releaseType) || /2160p|4k|uhd/i.test(r.title)).length,
    '1080p': group.releases.filter(r => /1080p/i.test(r.releaseType) || /1080p/i.test(r.title)).length,
    '720p': group.releases.filter(r => /720p/i.test(r.releaseType) || /720p/i.test(r.title)).length,
    packs: group.releases.filter(r => r.releaseType.includes('📦') || detectSeasonPack(r.title).isPack || detectSeasonPack(r.releaseType).isPack).length,
  };

  // Filter releases by quality and search query
  const filteredReleases = group.releases.filter(r => {
    if (qualityFilter === '4k') {
      if (!/2160p|4k|uhd/i.test(r.releaseType) && !/2160p|4k|uhd/i.test(r.title)) return false;
    } else if (qualityFilter === '1080p') {
      if (!/1080p/i.test(r.releaseType) && !/1080p/i.test(r.title)) return false;
    } else if (qualityFilter === '720p') {
      if (!/720p/i.test(r.releaseType) && !/720p/i.test(r.title)) return false;
    } else if (qualityFilter === 'packs') {
      const isPack = r.releaseType.includes('📦') || detectSeasonPack(r.title).isPack || detectSeasonPack(r.releaseType).isPack;
      if (!isPack) return false;
    }

    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return r.title.toLowerCase().includes(q) || r.releaseType.toLowerCase().includes(q);
  });

  // Intelligent Sorting by Episode, Quality, Date, Name (Ascending / Descending)
  const sortedReleases = [...filteredReleases].sort((a, b) => {
    let comparison = 0;

    if (sortBy === 'episode') {
      const epA = parseEpisodeInfo(a.title, a.releaseType);
      const epB = parseEpisodeInfo(b.title, b.releaseType);
      // Priority to Season first, then Episode!
      comparison = epA.sortPriority - epB.sortPriority;
      if (comparison === 0) {
        // If same episode, sort by quality rank
        const qualityRank = (type: string, title: string) => {
          const text = `${type} ${title}`.toLowerCase();
          if (text.includes('4k') || text.includes('2160p')) return 4;
          if (text.includes('1080p')) return 3;
          if (text.includes('bluray')) return 2;
          if (text.includes('720p')) return 1;
          return 0;
        };
        comparison = qualityRank(a.releaseType, a.title) - qualityRank(b.releaseType, b.title);
      }
    } else if (sortBy === 'name') {
      comparison = a.title.localeCompare(b.title);
    } else if (sortBy === 'date') {
      comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    } else if (sortBy === 'quality') {
      const qualityRank = (type: string, title: string) => {
        const text = `${type} ${title}`.toLowerCase();
        if (text.includes('4k') || text.includes('2160p')) return 4;
        if (text.includes('1080p')) return 3;
        if (text.includes('bluray')) return 2;
        if (text.includes('720p')) return 1;
        return 0;
      };
      comparison = qualityRank(a.releaseType, a.title) - qualityRank(b.releaseType, b.title);
      if (comparison === 0) {
        comparison = (a.seeders || 0) - (b.seeders || 0);
      }
    }

    return sortOrder === 'asc' ? comparison : -comparison;
  });

  // Group releases by Episode for TV shows when enabled
  const episodeGroups = isSeriesOrTV && groupByEpisode ? sortedReleases.reduce((acc, rel) => {
    const epInfo = parseEpisodeInfo(rel.title, rel.releaseType);
    const key = epInfo.groupKey;
    if (!acc[key]) {
      acc[key] = {
        epInfo,
        releases: []
      };
    }
    acc[key].releases.push(rel);
    return acc;
  }, {} as Record<string, { epInfo: ParsedEpisode; releases: ReleaseItem[] }>) : null;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      {/* Top Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 sm:p-5 rounded-2xl border border-gray-100 shadow-sm">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-sm font-medium transition-colors cursor-pointer group"
          title={getBackLabel()}
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          <span>{getBackLabel()}</span>
        </button>

        <div className="flex flex-wrap items-center gap-3">
          {/* If discovered item, display 1-Click Toggle Add / Remove Watchlist button */}
          {discoveredItem && (
            <button
              onClick={handleToggleDiscoveredWatchlist}
              disabled={addingToWatchlist}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-sm ${
                discoveredItem.inWatchlist
                  ? 'bg-emerald-50 hover:bg-rose-50 text-emerald-700 hover:text-rose-700 border border-emerald-200 hover:border-rose-300 group cursor-pointer'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer'
              }`}
              title={discoveredItem.inWatchlist ? "Currently in Watchlist. Click to remove." : "Add to Watchlist"}
            >
              {addingToWatchlist ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Updating Watchlist...</span>
                </>
              ) : discoveredItem.inWatchlist ? (
                <>
                  <Check className="w-4 h-4 text-emerald-600 group-hover:hidden" />
                  <Trash2 className="w-4 h-4 text-rose-600 hidden group-hover:inline" />
                  <span className="group-hover:hidden">In Watchlist (Alerts Active)</span>
                  <span className="hidden group-hover:inline">Remove from Watchlist</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>+ Add to Watchlist</span>
                </>
              )}
            </button>
          )}

          <button
            onClick={handleCopyPageLink}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-sm font-semibold transition-colors border border-indigo-200/60"
          >
            {copiedLink ? (
              <>
                <Check className="w-4 h-4 text-emerald-600" />
                <span>Link Copied!</span>
              </>
            ) : (
              <>
                <Share2 className="w-4 h-4" />
                <span>Share Direct Page Link</span>
              </>
            )}
          </button>

          {!discoveredItem && (
            <button
              onClick={handleOpenDeleteAll}
              className="inline-flex items-center gap-2 px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-sm font-semibold transition-colors border border-rose-200/60"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete Title</span>
            </button>
          )}
        </div>
      </div>

      {/* Hero Poster Banner */}
      <div className="relative rounded-3xl overflow-hidden bg-slate-950 border border-slate-800 shadow-xl">
        <div className="absolute inset-0 opacity-20 filter blur-2xl transform scale-110 pointer-events-none">
          {group.poster ? (
            <img src={group.poster} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/70 to-transparent" />
        </div>

        {/* Content Inside Hero */}
        <div className="relative p-6 sm:p-10 text-white z-10 flex flex-col md:flex-row gap-8 items-start">
          {/* Main Poster */}
          <div className="relative aspect-2/3 w-48 sm:w-60 rounded-2xl overflow-hidden shadow-2xl border-2 border-white/20 bg-slate-800 shrink-0 mx-auto md:mx-0">
            {group.poster ? (
              <img 
                src={group.poster} 
                alt={group.canonicalTitle} 
                className="w-full h-full object-cover" 
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 font-medium bg-slate-900 p-4 text-center">
                <Film className="w-10 h-10 mb-2 opacity-30 text-indigo-400" />
                <span>No Poster</span>
              </div>
            )}

            <div className="absolute top-3 left-3">
              <Badge variant="default" className="bg-black/75 backdrop-blur-md text-white border-none shadow-md font-bold px-3 py-1">
                {group.type}
              </Badge>
            </div>
          </div>

          {/* Title and Metadata */}
          <div className="flex-1 space-y-5">
            <div>
              <div className="flex flex-wrap items-center gap-2.5 mb-2">
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-indigo-500/20 text-indigo-200 border border-indigo-400/30 backdrop-blur-md">
                  {group.year}
                </span>

                {metadata.imdbRating && metadata.imdbRating !== 'N/A' && (
                  <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-400/30 backdrop-blur-md">
                    <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                    IMDb {metadata.imdbRating}
                  </span>
                )}

                {metadata.runtime && metadata.runtime !== 'N/A' && (
                  <span className="flex items-center gap-1.5 text-xs text-slate-300 font-medium bg-slate-800/60 px-3 py-1 rounded-full border border-slate-700 backdrop-blur-md">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    {metadata.runtime}
                  </span>
                )}
              </div>

              <h1 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">
                {group.canonicalTitle}
              </h1>

              {metadata.releaseDate && (
                <p className="text-xs text-slate-400 mt-2 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-indigo-400" /> Release Date: {metadata.releaseDate}
                </p>
              )}
            </div>

            {/* Genres */}
            {metadata.genres && (
              <div className="flex flex-wrap gap-2">
                {metadata.genres.split(',').map((genre: string, idx: number) => (
                  <span key={idx} className="px-3 py-1 bg-white/10 text-slate-200 text-xs font-medium rounded-lg backdrop-blur-md border border-white/10">
                    {genre.trim()}
                  </span>
                ))}
              </div>
            )}

            {/* Plot Overview */}
            <p className="text-slate-300 text-sm sm:text-base leading-relaxed max-w-3xl">
              {metadata.overview || 'No overview available for this title.'}
            </p>

            {/* External Ratings & Info Links */}
            <div className="pt-2">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                Reviews & External Search
              </h4>
              <div className="flex flex-wrap gap-2.5">
                <a
                  href={letterboxdUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#00e054] hover:bg-[#00c048] text-black font-bold rounded-xl text-xs transition-all shadow-md hover:scale-105"
                >
                  <Sparkles className="w-4 h-4 fill-black" />
                  Letterboxd
                  <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                </a>

                <a
                  href={rottenTomatoesUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#FA320A] hover:bg-[#d92905] text-white font-bold rounded-xl text-xs transition-all shadow-md hover:scale-105"
                >
                  <span className="text-base leading-none">🍅</span>
                  Rotten Tomatoes
                  <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                </a>

                <a
                  href={imdbSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#f5c518] hover:bg-[#e2b30e] text-black font-bold rounded-xl text-xs transition-all shadow-md hover:scale-105"
                >
                  <Star className="w-4 h-4 fill-black" />
                  IMDb
                  <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                </a>

                <a
                  href={googleSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-all hover:scale-105"
                >
                  <Search className="w-4 h-4 text-slate-400" />
                  Google Search
                  <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Production Details Grid */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 text-sm">
        {metadata.director && metadata.director !== 'N/A' && (
          <div>
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1">Director</span>
            <span className="font-semibold text-gray-900">{metadata.director}</span>
          </div>
        )}
        {metadata.cast && metadata.cast !== 'N/A' && (
          <div className="sm:col-span-2">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1">Cast</span>
            <span className="font-medium text-gray-800 line-clamp-2">{metadata.cast}</span>
          </div>
        )}
        {metadata.country && (
          <div>
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1">Country</span>
            <span className="font-medium text-gray-800">{metadata.country}</span>
          </div>
        )}
      </div>

      {/* Navigation Tabs inside Detailed Page */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200">
        <button
          type="button"
          onClick={() => setDetailTab('releases')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition-all cursor-pointer ${
            detailTab === 'releases'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Torrent Releases & Magnets</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
            {group.releases.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setDetailTab('episodes')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition-all cursor-pointer ${
            detailTab === 'episodes'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300'
          }`}
        >
          <Tv className="w-4 h-4" />
          <span>Episode Availability Matrix</span>
          <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
            Live Airing Tracker
          </span>
        </button>
      </div>

      {/* Tab 1: Episode Availability Matrix (Only shown if admin selects this tab) */}
      {detailTab === 'episodes' && (
        <EpisodeProgressTracker
          seriesTitle={group.canonicalTitle}
          year={group.year}
          tmdbId={discoveredItem?.tmdbId || metadata.tmdbId}
          onFilterEpisode={(epCode) => {
            setDetailTab('releases');
            setSearchQuery(epCode);
            setSortBy('episode');
          }}
        />
      )}

      {/* Tab 2: Releases & Qualities Section (Only shown if admin selects releases tab) */}
      {detailTab === 'releases' && (
        <div className="bg-white p-6 sm:p-8 rounded-2xl border border-gray-100 shadow-sm space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-gray-100 pb-5">
          <div>
            <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2.5">
              <Layers className="w-5 h-5 text-indigo-600" />
              Available Releases & Magnets ({group.releases.length})
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              All torrent qualities, formats, and verified magnet download links.
            </p>
          </div>

          {/* Advanced Sorting and Filtering Toolbar */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Search Bar */}
            <div className="relative min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search releases..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-2xs"
              />
            </div>

            {/* Sort Criteria Selector: Episode, Quality, Date, Name */}
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl border border-gray-200 text-xs font-semibold">
              <span className="text-gray-400 pl-2 pr-1 flex items-center gap-1">
                <ArrowUpDown className="w-3.5 h-3.5" />
                Sort:
              </span>
              
              {isSeriesOrTV && (
                <button
                  onClick={() => setSortBy('episode')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    sortBy === 'episode' 
                      ? 'bg-indigo-600 text-white font-bold shadow-xs' 
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  title="Sort by Season then Episode"
                >
                  Episode
                </button>
              )}

              <button
                onClick={() => setSortBy('quality')}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  sortBy === 'quality' 
                    ? 'bg-indigo-600 text-white font-bold shadow-xs' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Quality
              </button>

              <button
                onClick={() => setSortBy('date')}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  sortBy === 'date' 
                    ? 'bg-slate-800 text-white font-bold shadow-xs' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Date
              </button>

              <button
                onClick={() => setSortBy('name')}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  sortBy === 'name' 
                    ? 'bg-slate-800 text-white font-bold shadow-xs' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Name
              </button>
            </div>

            {/* Sort Order Toggle: Ascending vs Descending */}
            <button
              onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
              className="inline-flex items-center gap-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-xs font-bold border border-gray-200 transition-colors shadow-2xs"
              title={sortOrder === 'asc' ? 'Currently Ascending (Click for Descending)' : 'Currently Descending (Click for Ascending)'}
            >
              {sortOrder === 'asc' ? (
                <>
                  <ArrowUp className="w-3.5 h-3.5 text-indigo-600" />
                  <span>ASC</span>
                </>
              ) : (
                <>
                  <ArrowDown className="w-3.5 h-3.5 text-indigo-600" />
                  <span>DESC</span>
                </>
              )}
            </button>

            {/* Episode Grouping Toggle (for Series/Anime/Animation) */}
            {isSeriesOrTV && (
              <button
                onClick={() => setGroupByEpisode(prev => !prev)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                  groupByEpisode 
                    ? 'bg-purple-50 text-purple-700 border-purple-200 shadow-2xs' 
                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                }`}
                title="Group multiple qualities of the exact same episode together"
              >
                <ListFilter className="w-3.5 h-3.5 text-purple-600" />
                {groupByEpisode ? 'Grouped by Episode' : 'Flat List'}
              </button>
            )}
          </div>
        </div>

        {/* Quality Filter Tabs */}
        <div className="flex flex-wrap items-center gap-2 pt-1 pb-1">
          <button
            onClick={() => setQualityFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              qualityFilter === 'all'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All Qualities
            <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${qualityFilter === 'all' ? 'bg-slate-700 text-slate-200' : 'bg-gray-200 text-gray-700'}`}>
              {qualityCounts.all}
            </span>
          </button>

          {qualityCounts['4k'] > 0 && (
            <button
              onClick={() => setQualityFilter('4k')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                qualityFilter === '4k'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200/60'
              }`}
            >
              ✨ 4K UHD
              <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${qualityFilter === '4k' ? 'bg-purple-800 text-purple-200' : 'bg-purple-100 text-purple-800'}`}>
                {qualityCounts['4k']}
              </span>
            </button>
          )}

          {qualityCounts['1080p'] > 0 && (
            <button
              onClick={() => setQualityFilter('1080p')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                qualityFilter === '1080p'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200/60'
              }`}
            >
              🍿 1080p Full HD
              <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${qualityFilter === '1080p' ? 'bg-indigo-800 text-indigo-200' : 'bg-indigo-100 text-indigo-800'}`}>
                {qualityCounts['1080p']}
              </span>
            </button>
          )}

          {qualityCounts['720p'] > 0 && (
            <button
              onClick={() => setQualityFilter('720p')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                qualityFilter === '720p'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200/60'
              }`}
            >
              📺 720p HD
              <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${qualityFilter === '720p' ? 'bg-emerald-800 text-emerald-200' : 'bg-emerald-100 text-emerald-800'}`}>
                {qualityCounts['720p']}
              </span>
            </button>
          )}

          {qualityCounts.packs > 0 && (
            <button
              onClick={() => setQualityFilter('packs')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                qualityFilter === 'packs'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200/60'
              }`}
            >
              📦 Season Packs
              <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${qualityFilter === 'packs' ? 'bg-amber-800 text-amber-200' : 'bg-amber-100 text-amber-800'}`}>
                {qualityCounts.packs}
              </span>
            </button>
          )}
        </div>

        {/* Releases Display: Either Grouped by Episode OR Flat Sorted List */}
        {episodeGroups ? (
          <div className="space-y-6">
            {Object.keys(episodeGroups).map(epKey => {
              const epGroup = episodeGroups[epKey];
              return (
                <div key={epKey} className="border border-gray-200/80 rounded-2xl p-4 bg-gray-50/50 space-y-3 shadow-2xs">
                  {/* Episode Group Header */}
                  <div className="flex items-center justify-between border-b border-gray-200/60 pb-2.5">
                    <div className="flex items-center gap-2">
                      <Tv className="w-4 h-4 text-indigo-600" />
                      <h4 className="font-bold text-gray-900 text-sm">
                        {epGroup.epInfo.label}
                      </h4>
                      <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 text-[10px]">
                        {epGroup.epInfo.code}
                      </Badge>
                    </div>
                    <span className="text-xs text-gray-500 font-medium">
                      {epGroup.releases.length} {epGroup.releases.length === 1 ? 'version' : 'versions'}
                    </span>
                  </div>

                  {/* Releases for this exact episode */}
                  <div className="space-y-2.5">
                    {epGroup.releases.map(rel => renderReleaseRow(rel))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            {sortedReleases.map(rel => renderReleaseRow(rel))}
          </div>
        )}
      </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!deleteConfirm?.isOpen}
        title={deleteConfirm?.type === 'all' ? 'Delete Movie & All Releases?' : 'Permanently Delete & Blacklist Download?'}
        message={
          deleteConfirm?.type === 'all'
            ? `Are you sure you want to delete "${group?.canonicalTitle}" and all ${group?.releases.length || 1} discovered quality releases?`
            : `Are you sure you want to delete "${deleteConfirm?.releaseTitle || deleteConfirm?.releaseLabel}"? It will be permanently blacklisted and will NEVER be added again. If this was a fake episode release, you will still be notified when the real episode is released.`
        }
        confirmLabel={deleteConfirm?.type === 'all' ? 'Delete All' : 'Permanently Blacklist'}
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );

  function renderReleaseRow(rel: ReleaseItem) {
    const isMagnetUrl = rel.sourceUrl && rel.sourceUrl.startsWith('magnet:');
    const isHttpUrl = rel.sourceUrl && (rel.sourceUrl.startsWith('http://') || rel.sourceUrl.startsWith('https://'));
    const packInfo = detectSeasonPack(rel.title);
    const isPack = packInfo.isPack || rel.releaseType.includes('📦');
    const fileSize = getReleaseSize(rel);

    return (
      <div 
        key={rel.id} 
        className={`p-4 rounded-2xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 group ${
          isPack 
            ? 'bg-amber-50/40 hover:bg-amber-50/70 border-amber-200/80 shadow-xs' 
            : 'bg-white hover:bg-indigo-50/40 border-gray-200/80 shadow-2xs'
        }`}
      >
        <div className="space-y-2 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* Quality Badge */}
            <span className={`px-3 py-1 rounded-lg text-xs font-bold border shadow-xs ${getQualityBadgeColor(rel.releaseType)}`}>
              {rel.releaseType}
            </span>

            {/* File Size Badge */}
            {fileSize && (
              <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-sky-50 text-sky-800 border border-sky-200/90 flex items-center gap-1 shadow-2xs">
                <HardDrive className="w-3.5 h-3.5 text-sky-600" />
                <span>{fileSize}</span>
              </span>
            )}

            {/* Season Pack Distinct Badge */}
            {isPack && (
              <span className="px-2.5 py-0.5 bg-amber-500/15 text-amber-800 border border-amber-300 font-extrabold text-[11px] rounded-md flex items-center gap-1 shadow-2xs">
                📦 Complete Season Pack
              </span>
            )}

            {/* Provider */}
            <span className="text-xs text-gray-500 font-medium flex items-center gap-1">
              <Globe className="w-3 h-3" /> {rel.provider}
            </span>

            {/* Seeds & Peers if available */}
            {rel.seeders !== undefined && (
              <span className="text-xs text-emerald-600 font-semibold">
                • {rel.seeders} Seeds
              </span>
            )}

            {/* Discovery Timestamp */}
            <span className="text-xs text-gray-400">
              • {formatDistanceToNow(new Date(rel.createdAt), { addSuffix: true })}
            </span>
          </div>

          <p className="text-xs sm:text-sm font-mono text-gray-800 font-medium break-all group-hover:text-indigo-950 transition-colors">
            {rel.title}
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0 pt-2 md:pt-0">
          {isMagnetUrl && (
            <>
              <button
                onClick={() => handleCopyReleaseLink(rel)}
                className="px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-xl border border-emerald-200 transition-colors text-xs font-semibold flex items-center gap-1.5 shadow-sm"
                title="Copy Magnet Link"
              >
                {copiedId === rel.id ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-700">Copied Magnet!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Magnet</span>
                  </>
                )}
              </button>

              <a
                href={rel.sourceUrl}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
                title="Open in Torrent Client"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Open Magnet</span>
              </a>
            </>
          )}

          {isHttpUrl && (
            <>
              <button
                onClick={() => handleCopyReleaseLink(rel)}
                className="px-3.5 py-2 bg-white hover:bg-gray-100 text-gray-700 hover:text-gray-900 rounded-xl border border-gray-200 transition-colors text-xs font-medium flex items-center gap-1.5 shadow-sm"
                title="Copy Source Link"
              >
                {copiedId === rel.id ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-600 font-semibold">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Link</span>
                  </>
                )}
              </button>

              <a
                href={rel.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
              >
                <span>Open Link</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </>
          )}

          <button
            onClick={() => handleOpenDeleteSingle(rel)}
            className="p-2 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl border border-rose-200 transition-colors cursor-pointer"
            title="Permanently delete & blacklist this download"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }
}
