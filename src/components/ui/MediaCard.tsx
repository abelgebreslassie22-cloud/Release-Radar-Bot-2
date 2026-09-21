import React from 'react';
import { Calendar, Star, Film, Layers, Trash2 } from 'lucide-react';
import { MediaGroup } from '../../utils/mediaGrouper';
import { Badge } from './Badge';

interface MediaCardProps {
  group: MediaGroup;
  onClick: () => void;
  onDelete?: (group: MediaGroup, e: React.MouseEvent) => void;
}

export const MediaCard: React.FC<MediaCardProps> = ({ group, onClick, onDelete }) => {
  const metadata = group.metadata || {};
  const releaseCount = group.releases.length;
  const displayTitle = group.canonicalTitle;

  return (
    <div 
      onClick={onClick}
      className="group cursor-pointer flex flex-col h-full bg-white rounded-2xl border border-gray-100 p-3 hover:border-indigo-200 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1"
    >
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-gray-100 mb-3 shadow-sm border border-gray-200/60">
        {group.poster ? (
          <img 
            src={group.poster} 
            alt={group.canonicalTitle} 
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out" 
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 font-medium bg-gray-50 p-4 text-center">
            <Film className="w-8 h-8 mb-2 opacity-40 text-indigo-400" />
            <span className="text-xs">No Poster Available</span>
          </div>
        )}

        {/* Top Dark Overlay Gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-gray-950/80 via-transparent to-black/30 opacity-60 group-hover:opacity-80 transition-opacity duration-300" />
        
        {/* Top Left Badges */}
        <div className="absolute top-2 left-2 flex flex-col gap-1 z-10">
          <Badge variant="default" className="bg-slate-900/80 backdrop-blur-md text-white border-none shadow-sm text-[11px] px-2 py-0.5">
            {group.type}
          </Badge>
          {group.availableQualities[0] && (
            <Badge variant="default" className="bg-indigo-600/90 backdrop-blur-md text-white border-none shadow-sm text-[11px] px-2 py-0.5 font-bold">
              {group.availableQualities[0]}
            </Badge>
          )}
        </div>

        {/* Top Right Actions / Badges */}
        <div className="absolute top-2 right-2 flex items-center gap-1.5 z-30">
          {releaseCount > 1 && (
            <div className="bg-emerald-600/90 backdrop-blur-md text-white text-[11px] font-bold px-2 py-0.5 rounded-full shadow-md flex items-center gap-1">
              <Layers className="w-3 h-3" />
              {releaseCount}
            </div>
          )}

          {onDelete && (
            <button
              type="button"
              aria-label="Delete release"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(group, e);
              }}
              className="p-1.5 bg-rose-600/90 hover:bg-rose-700 text-white rounded-full shadow-md backdrop-blur-md transition-all hover:scale-110 active:scale-95 cursor-pointer z-30"
              title="Delete release"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Bottom Left IMDb Rating Badge */}
        {metadata.imdbRating && metadata.imdbRating !== 'N/A' && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/75 backdrop-blur-md text-white text-xs font-bold px-2 py-1 rounded-lg z-10">
            <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
            {metadata.imdbRating}
          </div>
        )}

        {/* Hover Click Prompt */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10 pointer-events-none">
          <span className="px-3 py-1.5 bg-white/95 backdrop-blur-md text-gray-900 font-bold text-xs rounded-full shadow-lg border border-white transform scale-90 group-hover:scale-100 transition-transform">
            View Details & Qualities
          </span>
        </div>
      </div>
      
      {/* Card Info */}
      <div className="flex-1 flex flex-col justify-between">
        <div>
          <h4 className="font-bold text-gray-900 text-base line-clamp-1 group-hover:text-indigo-600 transition-colors" title={displayTitle}>
            {displayTitle}
          </h4>

          <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
            <span className="flex items-center gap-1 font-medium">
              <Calendar className="w-3 h-3 text-gray-400" /> {group.year}
            </span>
            <span className="w-1 h-1 rounded-full bg-gray-300" />
            <span className="truncate">{group.releases[0]?.provider || 'Movie Radar'}</span>
          </div>
        </div>

        {/* Quality Badges Row */}
        <div className="flex items-center justify-between gap-1 mt-3 pt-2 border-t border-gray-100">
          <div className="flex flex-wrap gap-1">
            {group.availableQualities.slice(0, 3).map((q, idx) => (
              <span 
                key={idx} 
                className="px-1.5 py-0.5 bg-gray-100 text-gray-700 text-[10px] font-semibold rounded"
              >
                {q}
              </span>
            ))}
            {group.availableQualities.length > 3 && (
              <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-semibold rounded">
                +{group.availableQualities.length - 3}
              </span>
            )}
          </div>
          
          <span className="text-[10px] font-medium text-gray-400">
            {releaseCount} {releaseCount === 1 ? 'release' : 'releases'}
          </span>
        </div>
      </div>
    </div>
  );
};
