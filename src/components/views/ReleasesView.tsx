import React, { useState, useEffect } from 'react';
import { format, isToday, isYesterday } from 'date-fns';
import { Search, Filter, Film } from 'lucide-react';
import { Skeleton } from '../ui/Skeleton';
import { groupReleases, MediaGroup, ReleaseItem } from '../../utils/mediaGrouper';
import { MediaCard } from '../ui/MediaCard';
import { useToast } from '../ui/Toast';
import { ConfirmModal } from '../ui/ConfirmModal';

interface ReleasesViewProps {
  onSelectMedia?: (groupKey: string) => void;
}

export default function ReleasesView({ onSelectMedia }: ReleasesViewProps) {
  const [rawReleases, setRawReleases] = useState<ReleaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<MediaGroup | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetch('/api/releases')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setRawReleases(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleDeleteClick = (group: MediaGroup, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTarget(group);
  };

  const confirmDeleteGroup = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);

    try {
      const ids = deleteTarget.releases.map(r => r.id);
      const res = await fetch('/api/releases/delete-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast(`Deleted "${deleteTarget.canonicalTitle}"`, 'success');
        const idsSet = new Set(ids);
        setRawReleases(prev => prev.filter(r => !idsSet.has(r.id)));
      } else {
        toast(data.error || 'Failed to delete release', 'error');
      }
    } catch (err: any) {
      toast('Error deleting release', 'error');
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  // Group releases into 1 poster per movie/series
  const mediaGroups = groupReleases(rawReleases);

  // Filter groups by search query
  const filteredGroups = mediaGroups.filter(g => 
    g.canonicalTitle.toLowerCase().includes(search.toLowerCase()) || 
    g.year.toString().includes(search) ||
    g.type.toLowerCase().includes(search.toLowerCase()) ||
    g.availableQualities.some(q => q.toLowerCase().includes(search.toLowerCase()))
  );

  // Group media by date discovered
  const groupedByDate = filteredGroups.reduce((acc, group) => {
    const date = new Date(group.latestCreatedAt);
    let key = 'Earlier';
    if (isToday(date)) key = 'Today';
    else if (isYesterday(date)) key = 'Yesterday';
    else key = format(date, 'MMM d, yyyy');

    if (!acc[key]) acc[key] = [];
    acc[key].push(group);
    return acc;
  }, {} as Record<string, MediaGroup[]>);

  const handleCardClick = (groupKey: string) => {
    if (onSelectMedia) {
      onSelectMedia(groupKey);
    } else {
      window.location.hash = `#/media/${encodeURIComponent(groupKey)}`;
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Recent Releases</h2>
          <p className="text-gray-500 text-sm mt-1">
            Grouped discovered titles from your watchlist. Click any title to open its dedicated movie detail page.
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input 
              type="text" 
              placeholder="Search title, year, quality..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all w-full sm:w-64"
            />
          </div>
          <button className="p-2 bg-white border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
            <Filter className="w-4 h-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-6">
          <h3 className="text-lg font-semibold text-gray-700">Loading...</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="space-y-3">
                <Skeleton className="w-full aspect-[2/3] rounded-xl" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        </div>
      ) : Object.keys(groupedByDate).length === 0 ? (
        <div className="text-center py-20 bg-white rounded-2xl border border-gray-100 border-dashed">
          <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Film className="w-6 h-6 text-indigo-500" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">No releases found</h3>
          <p className="text-gray-500 text-sm">Add items to your watchlist or trigger a scan to discover releases.</p>
        </div>
      ) : (
        (Object.entries(groupedByDate) as [string, MediaGroup[]][]).map(([dateLabel, groups]) => (
          <div key={dateLabel} className="space-y-4">
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-3">
              {dateLabel}
              <span className="text-xs font-normal text-gray-400">({groups.length} titles)</span>
              <span className="flex-1 h-px bg-gray-100" />
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              {groups.map(group => (
                <MediaCard 
                  key={group.groupKey} 
                  group={group} 
                  onClick={() => handleCardClick(group.groupKey)} 
                  onDelete={handleDeleteClick}
                />
              ))}
            </div>
          </div>
        ))
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        title="Delete Movie Poster & Releases?"
        message={`Are you sure you want to delete "${deleteTarget?.canonicalTitle}" and all ${deleteTarget?.releases.length || 1} discovered quality releases?`}
        confirmLabel="Delete Movie"
        isLoading={isDeleting}
        onConfirm={confirmDeleteGroup}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
