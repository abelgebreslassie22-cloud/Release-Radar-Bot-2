import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, Star, Calendar, Clock, Film, ExternalLink, Copy, Check, 
  Layers, Globe, Search, Share2, Sparkles, AlertCircle,
  ArrowUpDown, Zap, ShieldCheck, Trash2
} from 'lucide-react';
import { groupReleases, MediaGroup, ReleaseItem } from '../../utils/mediaGrouper';
import { Badge } from '../ui/Badge';
import { useToast } from '../ui/Toast';
import { Skeleton } from '../ui/Skeleton';
import { ConfirmModal } from '../ui/ConfirmModal';
import { formatDistanceToNow } from 'date-fns';

interface MediaDetailViewProps {
  groupKey: string;
  onBack: () => void;
}

export default function MediaDetailView({ groupKey, onBack }: MediaDetailViewProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<MediaGroup | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [sortBy, setSortBy] = useState<'quality' | 'date'>('quality');
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    type: 'all' | 'single';
    releaseId?: number;
    releaseLabel?: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setLoading(true);
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

  const handleOpenDeleteAll = () => {
    setDeleteConfirm({
      isOpen: true,
      type: 'all',
    });
  };

  const handleOpenDeleteSingle = (releaseId: number, releaseLabel: string) => {
    setDeleteConfirm({
      isOpen: true,
      type: 'single',
      releaseId,
      releaseLabel,
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
          body: JSON.stringify({ ids }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          toast(`Deleted all releases for "${group.canonicalTitle}"`, 'success');
          onBack();
        } else {
          toast(data.error || 'Failed to delete releases', 'error');
        }
      } catch (e: any) {
        toast('Error deleting releases', 'error');
      } finally {
        setIsDeleting(false);
        setDeleteConfirm(null);
      }
    } else if (deleteConfirm.type === 'single' && deleteConfirm.releaseId) {
      try {
        const res = await fetch(`/api/releases/${deleteConfirm.releaseId}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok && data.success) {
          toast('Release deleted', 'success');
          const updatedReleases = group.releases.filter(r => r.id !== deleteConfirm.releaseId);
          if (updatedReleases.length === 0) {
            onBack();
          } else {
            setGroup({
              ...group,
              releases: updatedReleases,
            });
          }
        } else {
          toast(data.error || 'Failed to delete release', 'error');
        }
      } catch (e: any) {
        toast('Error deleting release', 'error');
      } finally {
        setIsDeleting(false);
        setDeleteConfirm(null);
      }
    }
  };

  const getQualityBadgeColor = (type: string) => {
    const lower = type.toLowerCase();
    if (lower.includes('4k') || lower.includes('2160p')) {
      return 'bg-purple-100 text-purple-800 border-purple-200';
    }
    if (lower.includes('1080p')) {
      return 'bg-indigo-100 text-indigo-800 border-indigo-200';
    }
    if (lower.includes('720p') || lower.includes('hd')) {
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    }
    if (lower.includes('bluray') || lower.includes('bdrip')) {
      return 'bg-blue-100 text-blue-800 border-blue-200';
    }
    return 'bg-gray-100 text-gray-800 border-gray-200';
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-32 rounded-xl" />
        </div>
        <Skeleton className="h-64 sm:h-80 w-full rounded-2xl" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 md:col-span-2 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="space-y-6 text-center py-20 bg-white rounded-2xl border border-gray-100">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900">Title Not Found</h2>
        <p className="text-gray-500 text-sm max-w-md mx-auto">
          The requested movie or series detail page could not be located or has no discovered releases yet.
        </p>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-colors shadow-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Releases
        </button>
      </div>
    );
  }

  const metadata = group.metadata || {};

  const letterboxdUrl = `https://letterboxd.com/search/${encodeURIComponent(group.canonicalTitle)}/`;
  const rottenTomatoesUrl = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(group.canonicalTitle)}`;
  const imdbSearchUrl = `https://www.imdb.com/find/?q=${encodeURIComponent(group.canonicalTitle)}`;
  const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(group.canonicalTitle + ' ' + group.type + ' watch online')}`;

  // Filter and sort releases
  const filteredReleases = group.releases.filter(r => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return r.title.toLowerCase().includes(q) || r.releaseType.toLowerCase().includes(q);
  });

  const sortedReleases = [...filteredReleases].sort((a, b) => {
    if (sortBy === 'date') {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }

    if (sortBy === 'quality') {
      const qualityRank = (type: string) => {
        const l = (type || '').toLowerCase();
        if (l.includes('4k') || l.includes('2160p')) return 4;
        if (l.includes('1080p')) return 3;
        if (l.includes('bluray')) return 2;
        if (l.includes('720p')) return 1;
        return 0;
      };
      const rankDiff = qualityRank(b.releaseType) - qualityRank(a.releaseType);
      if (rankDiff !== 0) return rankDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }

    return 0;
  });

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      {/* Top Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 sm:p-5 rounded-2xl border border-gray-100 shadow-sm">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-sm font-medium transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Releases
        </button>

        <div className="flex items-center gap-3">
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

          <button
            onClick={handleOpenDeleteAll}
            className="inline-flex items-center gap-2 px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-sm font-semibold transition-colors border border-rose-200"
            title="Delete all releases for this movie/series"
          >
            <Trash2 className="w-4 h-4 text-rose-600" />
            <span>Delete All Releases</span>
          </button>
        </div>
      </div>

      {/* Hero Banner with Glassmorphism Overlay */}
      <div className="relative rounded-3xl overflow-hidden bg-slate-950 shadow-xl border border-gray-100">
        <div className="absolute inset-0 h-full">
          {group.poster ? (
            <img 
              src={group.poster} 
              alt={group.canonicalTitle} 
              className="w-full h-full object-cover opacity-20 blur-2xl scale-125"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/70 to-transparent" />
        </div>

        {/* Content Inside Hero */}
        <div className="relative p-6 sm:p-10 text-white z-10 flex flex-col md:flex-row gap-8 items-start">
          {/* Main Poster */}
          <div className="relative aspect-[2/3] w-48 sm:w-60 rounded-2xl overflow-hidden shadow-2xl border-2 border-white/20 bg-slate-800 shrink-0 mx-auto md:mx-0">
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
                {/* Letterboxd Button */}
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

                {/* Rotten Tomatoes Button */}
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

                {/* IMDb Button */}
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

                {/* Google Search Button */}
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

      {/* Releases & Qualities Section */}
      <div className="bg-white p-6 sm:p-8 rounded-2xl border border-gray-100 shadow-sm space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-5">
          <div>
            <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2.5">
              <Layers className="w-5 h-5 text-indigo-600" />
              Discovered Releases & Qualities ({group.releases.length})
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              Discovered releases grouped by quality and tracked sources.
            </p>
          </div>

          {/* Sorting and Search Controls */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Search Bar */}
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search releases..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-sm"
                />
              </div>
            </div>

            {/* Sort Selector */}
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl border border-gray-200 text-xs font-semibold">
              <span className="text-gray-400 pl-2 pr-1 flex items-center gap-1">
                <ArrowUpDown className="w-3.5 h-3.5" />
                Sort:
              </span>
              <button
                onClick={() => setSortBy('quality')}
                className={`px-3 py-1 rounded-lg transition-all ${
                  sortBy === 'quality' 
                    ? 'bg-indigo-600 text-white font-bold shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Quality
              </button>
              <button
                onClick={() => setSortBy('date')}
                className={`px-3 py-1 rounded-lg transition-all ${
                  sortBy === 'date' 
                    ? 'bg-slate-800 text-white font-bold shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Date
              </button>
            </div>
          </div>
        </div>

        {/* List of Releases */}
        <div className="space-y-3">
          {sortedReleases.map((rel) => {
            const isHttpUrl = rel.sourceUrl && (rel.sourceUrl.startsWith('http://') || rel.sourceUrl.startsWith('https://'));
            return (
              <div 
                key={rel.id} 
                className="p-4 bg-gray-50/70 hover:bg-indigo-50/40 rounded-2xl border border-gray-200/80 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 group"
              >
                <div className="space-y-2 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Quality Badge */}
                    <span className={`px-3 py-1 rounded-lg text-xs font-bold border shadow-xs ${getQualityBadgeColor(rel.releaseType)}`}>
                      {rel.releaseType}
                    </span>

                    {/* Provider */}
                    <span className="text-xs text-gray-500 font-medium flex items-center gap-1">
                      <Globe className="w-3 h-3" /> {rel.provider}
                    </span>

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
                    onClick={() => handleOpenDeleteSingle(rel.id, rel.releaseType)}
                    className="p-2 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl border border-rose-200 transition-colors"
                    title="Delete this quality release"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!deleteConfirm?.isOpen}
        title={deleteConfirm?.type === 'all' ? 'Delete Movie & All Releases?' : 'Delete Single Quality Release?'}
        message={
          deleteConfirm?.type === 'all'
            ? `Are you sure you want to delete "${group?.canonicalTitle}" and all ${group?.releases.length || 1} discovered quality releases?`
            : `Are you sure you want to delete the "${deleteConfirm?.releaseLabel || 'selected'}" quality release for "${group?.canonicalTitle}"?`
        }
        confirmLabel="Delete"
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}
