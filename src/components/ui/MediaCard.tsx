import React, { useState } from 'react';
import { Calendar, Star, Film, HardDrive, Trash2, ChevronRight, Flame, Layers, Download, Check } from 'lucide-react';
import { MediaGroup } from '../../utils/mediaGrouper';
import { Card, CardContent } from './Card';
import { Badge } from './Badge';
import { Button } from './Button';
import { useToast } from './Toast';

interface MediaCardProps {
  group: MediaGroup;
  onClick: () => void;
  onDelete?: (group: MediaGroup, e: React.MouseEvent) => void;
}

export const MediaCard: React.FC<MediaCardProps> = ({ group, onClick, onDelete }) => {
  const metadata = group.metadata || {};
  const releaseCount = group.releases.length;
  const displayTitle = group.canonicalTitle;
  const { toast } = useToast();
  const [copiedMagnet, setCopiedMagnet] = useState(false);

  // Parse rating
  const rawRating = metadata.imdbRating || metadata.voteAverage;
  const rating = rawRating && rawRating !== 'N/A' 
    ? String(rawRating).replace('/10', '')
    : null;

  // Find best magnet link for quick download
  const bestRelease = group.releases.find(r => r.sourceUrl && r.sourceUrl.startsWith('magnet:')) || group.releases[0];
  const sizeText = metadata.sizeText || group.releases[0]?.metadataJson?.sizeText || '';
  const topQuality = group.availableQualities[0] || (group.releases[0]?.releaseType ? group.releases[0].releaseType.replace(/^🟢\s*Download Available:\s*/i, '').split('•')[0].trim() : 'WEB-DL');

  const handleQuickMagnet = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (bestRelease?.sourceUrl) {
      navigator.clipboard.writeText(bestRelease.sourceUrl);
      setCopiedMagnet(true);
      toast(`Copied verified magnet for "${displayTitle}"!`, 'success');
      setTimeout(() => setCopiedMagnet(false), 2000);
    } else {
      onClick();
    }
  };

  return (
    <Card 
      onClick={onClick}
      className="rounded-2xl border-gray-100 overflow-hidden flex flex-col hover:shadow-xl hover:border-indigo-200/80 transition-all duration-300 group cursor-pointer relative bg-white"
    >
      {/* Poster Container matching Discover New Drops */}
      <div className="relative aspect-2/3 w-full bg-gray-100 overflow-hidden">
        {group.poster ? (
          <img 
            src={group.poster} 
            alt={displayTitle} 
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out" 
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-gradient-to-br from-indigo-950 via-slate-900 to-gray-900 text-white">
            <Film className="w-10 h-10 mb-2 opacity-50 text-indigo-400" />
            <span className="font-bold text-sm leading-tight line-clamp-2">{displayTitle}</span>
            <span className="text-xs text-gray-400 mt-1">{group.year}</span>
          </div>
        )}

        {/* Hover Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-gray-950/85 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4 z-10 pointer-events-none">
          <span className="text-xs font-semibold text-white flex items-center gap-1.5 drop-shadow-md">
            Open Detailed Page <ChevronRight className="w-4 h-4 text-indigo-400" />
          </span>
        </div>

        {/* Top Badges Bar */}
        <div className="absolute top-2.5 inset-x-2.5 flex items-center justify-between gap-1 z-20">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="bg-black/60 backdrop-blur-md text-white border-white/20 text-[10px] font-semibold shadow-xs">
              {group.type}
            </Badge>

            {group.hasNewEpisodeToday ? (
              <Badge className="bg-gradient-to-r from-amber-500 to-rose-600 text-white border-transparent text-[10px] font-extrabold flex items-center gap-1 shadow-md animate-pulse">
                <Flame className="w-3 h-3 fill-white" />
                New Ep: {group.latestEpisode || 'Today'}
              </Badge>
            ) : group.releases.some(r => r.releaseType.includes('📦')) ? (
              <Badge className="bg-amber-500/95 text-white border-transparent text-[10px] font-bold flex items-center gap-1 shadow-xs">
                📦 Season Pack
              </Badge>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            {rating && (
              <Badge variant="outline" className="bg-amber-500/90 text-white border-transparent text-[10px] flex items-center gap-1 font-bold shadow-xs">
                <Star className="w-3 h-3 fill-white" />
                {rating}
              </Badge>
            )}

            {onDelete && (
              <button
                type="button"
                aria-label="Delete release"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(group, e);
                }}
                className="p-1.5 bg-black/60 hover:bg-rose-600 text-white rounded-full backdrop-blur-md transition-all hover:scale-110 active:scale-95 cursor-pointer shadow-md"
                title="Delete release card"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Bottom Poster Badges: Qualities count, Seeders, Size */}
        <div className="absolute bottom-2.5 inset-x-2.5 flex items-center justify-between gap-1.5 z-20 pointer-events-none">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-600/95 text-white backdrop-blur-md shadow-md">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
            {releaseCount} {releaseCount === 1 ? 'Quality' : 'Qualities'} • {group.topSeeders || 0} Seeds
          </span>

          {topQuality && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-900/85 text-sky-200 border border-sky-400/30 backdrop-blur-md shadow-xs">
              <HardDrive className="w-2.5 h-2.5 text-sky-300" />
              <span className="truncate max-w-[80px]">{topQuality}</span>
            </span>
          )}
        </div>
      </div>

      {/* Card Content matching Discover New Drops */}
      <CardContent className="p-4 flex-1 flex flex-col justify-between space-y-3 bg-white">
        <div>
          <h3 
            className="font-bold text-gray-900 text-sm line-clamp-1 group-hover:text-indigo-600 transition-colors" 
            title={displayTitle}
          >
            {displayTitle}
          </h3>

          <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
            <span className="font-semibold text-gray-700">{group.year}</span>
            <span>•</span>
            <span className="truncate max-w-[140px] text-gray-500 font-medium">
              {metadata.genres || group.type || 'Feature'}
            </span>
          </div>

          {/* New episode drop indicator banner */}
          {group.hasNewEpisodeToday && (
            <div className="mt-2.5 px-2.5 py-1.5 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-2 text-xs font-bold text-amber-900">
              <Flame className="w-3.5 h-3.5 text-amber-600 fill-amber-500 shrink-0" />
              <span className="truncate">
                New episode dropped today {group.latestEpisode ? `(${group.latestEpisode})` : ''}
              </span>
            </div>
          )}

          {metadata.overview && (
            <p className="text-xs text-gray-600 line-clamp-2 mt-2 leading-relaxed">
              {metadata.overview}
            </p>
          )}
        </div>

        {/* Footer toolbar: Quality pills & Quick Actions */}
        <div className="pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
          {/* Quality pills */}
          <div className="flex items-center gap-1 overflow-hidden">
            {group.availableQualities.slice(0, 2).map((q, idx) => (
              <span 
                key={idx} 
                className="px-1.5 py-0.5 bg-gray-100 text-gray-700 text-[10px] font-semibold rounded-md truncate max-w-[65px]"
              >
                {q}
              </span>
            ))}
            {group.availableQualities.length > 2 && (
              <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-semibold rounded-md">
                +{group.availableQualities.length - 2}
              </span>
            )}
          </div>

          {/* Action button */}
          <div className="flex items-center gap-1">
            {bestRelease?.sourceUrl && bestRelease.sourceUrl.startsWith('magnet:') ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handleQuickMagnet}
                className={`h-7 px-2.5 text-[11px] font-bold rounded-lg transition-all ${
                  copiedMagnet 
                    ? 'bg-emerald-600 text-white border-emerald-600' 
                    : 'bg-indigo-50/80 hover:bg-indigo-600 hover:text-white text-indigo-700 border-indigo-100'
                }`}
                title="Copy verified magnet link"
              >
                {copiedMagnet ? (
                  <>
                    <Check className="w-3 h-3 mr-1" /> Copied
                  </>
                ) : (
                  <>
                    <Download className="w-3 h-3 mr-1" /> Magnet
                  </>
                )}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={onClick}
                className="h-7 px-2 text-[11px] font-semibold text-gray-600 hover:text-indigo-600 rounded-lg"
              >
                Details <ChevronRight className="w-3 h-3 ml-0.5" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
