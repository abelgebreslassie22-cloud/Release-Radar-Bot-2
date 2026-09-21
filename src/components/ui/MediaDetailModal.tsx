import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Star, Calendar, Clock, Film, ExternalLink, Copy, Check, 
  Layers, Globe, Search, Tv, User, Video, ShieldCheck 
} from 'lucide-react';
import { MediaGroup, ReleaseItem } from '../../utils/mediaGrouper';
import { Badge } from './Badge';
import { useToast } from './Toast';
import { formatDistanceToNow, format } from 'date-fns';

interface MediaDetailModalProps {
  group: MediaGroup | null;
  onClose: () => void;
}

export function MediaDetailModal({ group, onClose }: MediaDetailModalProps) {
  const { toast } = useToast();
  const [copiedId, setCopiedId] = React.useState<number | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!group) return null;

  const metadata = group.metadata || {};

  const handleCopyLink = (release: ReleaseItem) => {
    if (release.sourceUrl) {
      navigator.clipboard.writeText(release.sourceUrl);
      setCopiedId(release.id);
      toast('Release URL copied to clipboard!', 'success');
      setTimeout(() => setCopiedId(null), 2000);
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

  const netflixSearchUrl = `https://www.netflix.com/search?q=${encodeURIComponent(group.canonicalTitle)}`;
  const maxSearchUrl = `https://www.max.com/search?q=${encodeURIComponent(group.canonicalTitle)}`;
  const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(group.canonicalTitle + ' ' + group.type + ' watch online')}`;
  const imdbSearchUrl = `https://www.imdb.com/find/?q=${encodeURIComponent(group.canonicalTitle)}`;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-3 sm:p-6">
        {/* Click outside backdrop */}
        <div className="fixed inset-0" onClick={onClose} />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2 }}
          className="relative bg-white rounded-2xl max-w-4xl w-full shadow-2xl border border-gray-100 overflow-hidden z-10 my-auto"
        >
          {/* Top Banner / Hero Image Overlay */}
          <div className="relative h-48 sm:h-64 bg-slate-900 overflow-hidden">
            {group.poster ? (
              <img 
                src={group.poster} 
                alt={group.canonicalTitle} 
                className="w-full h-full object-cover opacity-25 blur-xl scale-110"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-white via-white/40 to-transparent" />
            
            {/* Close Button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 w-9 h-9 rounded-full bg-slate-900/60 hover:bg-slate-900 text-white flex items-center justify-center backdrop-blur-md transition-all z-20 shadow-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Main Details Section */}
          <div className="relative px-6 sm:px-8 pb-8 -mt-28 sm:-mt-36">
            <div className="flex flex-col md:flex-row gap-6 items-start">
              {/* Poster */}
              <div className="relative aspect-[2/3] w-36 sm:w-48 md:w-56 rounded-xl overflow-hidden shadow-2xl border-2 border-white bg-gray-100 shrink-0 mx-auto md:mx-0">
                {group.poster ? (
                  <img 
                    src={group.poster} 
                    alt={group.canonicalTitle} 
                    className="w-full h-full object-cover" 
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400 font-medium bg-gray-100">
                    No Poster
                  </div>
                )}
                <div className="absolute top-3 left-3">
                  <Badge variant="default" className="bg-black/70 backdrop-blur-md text-white border-none shadow-md">
                    {group.type}
                  </Badge>
                </div>
              </div>

              {/* Title & Metadata Details */}
              <div className="flex-1 space-y-4 pt-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                      {group.year}
                    </span>
                    {metadata.imdbRating && metadata.imdbRating !== 'N/A' && (
                      <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                        <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                        IMDb {metadata.imdbRating}
                      </span>
                    )}
                    {metadata.runtime && metadata.runtime !== 'N/A' && (
                      <span className="flex items-center gap-1 text-xs text-gray-500 font-medium">
                        <Clock className="w-3.5 h-3.5 text-gray-400" />
                        {metadata.runtime}
                      </span>
                    )}
                  </div>
                  
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
                    {group.canonicalTitle}
                  </h2>
                  
                  {metadata.releaseDate && (
                    <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" /> Release Date: {metadata.releaseDate}
                    </p>
                  )}
                </div>

                {/* Genres */}
                {metadata.genres && (
                  <div className="flex flex-wrap gap-1.5">
                    {metadata.genres.split(',').map((genre: string, idx: number) => (
                      <span key={idx} className="px-2.5 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded-md">
                        {genre.trim()}
                      </span>
                    ))}
                  </div>
                )}

                {/* Synopsis / Overview */}
                <p className="text-gray-600 text-sm leading-relaxed">
                  {metadata.overview || 'No description available for this title.'}
                </p>

                {/* Director & Cast */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs text-gray-600 border-t border-gray-100">
                  {metadata.director && metadata.director !== 'N/A' && (
                    <div>
                      <span className="font-semibold text-gray-900 block mb-0.5">Director</span>
                      <span className="text-gray-600">{metadata.director}</span>
                    </div>
                  )}
                  {metadata.cast && metadata.cast !== 'N/A' && (
                    <div className="sm:col-span-2">
                      <span className="font-semibold text-gray-900 block mb-0.5">Cast</span>
                      <span className="text-gray-600 line-clamp-2">{metadata.cast}</span>
                    </div>
                  )}
                  {metadata.country && (
                    <div>
                      <span className="font-semibold text-gray-900 block mb-0.5">Country</span>
                      <span>{metadata.country}</span>
                    </div>
                  )}
                  {metadata.language && (
                    <div>
                      <span className="font-semibold text-gray-900 block mb-0.5">Language</span>
                      <span>{metadata.language}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Watch & External Links Section */}
            <div className="mt-8 pt-6 border-t border-gray-100">
              <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Tv className="w-4 h-4 text-indigo-600" />
                Find & Watch Online
              </h4>
              <div className="flex flex-wrap gap-2.5">
                <a
                  href={netflixSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="inline-flex items-center gap-2 px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-medium transition-colors shadow-sm"
                >
                  <Tv className="w-3.5 h-3.5" />
                  Search Netflix
                  <ExternalLink className="w-3 h-3 opacity-70" />
                </a>

                <a
                  href={maxSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="inline-flex items-center gap-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors shadow-sm"
                >
                  <Film className="w-3.5 h-3.5" />
                  Search Max / HBO
                  <ExternalLink className="w-3 h-3 opacity-70" />
                </a>

                <a
                  href={imdbSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="inline-flex items-center gap-2 px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-black rounded-lg text-xs font-semibold transition-colors shadow-sm"
                >
                  <Star className="w-3.5 h-3.5 fill-black" />
                  IMDb Page
                  <ExternalLink className="w-3 h-3 opacity-70" />
                </a>

                <a
                  href={googleSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="inline-flex items-center gap-2 px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-xs font-medium transition-colors border border-gray-200"
                >
                  <Search className="w-3.5 h-3.5 text-gray-500" />
                  Google Search
                  <ExternalLink className="w-3 h-3 opacity-70" />
                </a>
              </div>
            </div>

            {/* Available Discovered Releases List */}
            <div className="mt-8 pt-6 border-t border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-indigo-600" />
                    Discovered Releases ({group.releases.length})
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Discovered qualities and release entries tracked by Movie Radar
                  </p>
                </div>
                <span className="text-xs bg-indigo-50 text-indigo-700 font-semibold px-2.5 py-1 rounded-full border border-indigo-200">
                  {group.availableQualities.length} Qualities Available
                </span>
              </div>

              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {group.releases.map((rel) => {
                  const isHttpUrl = rel.sourceUrl && (rel.sourceUrl.startsWith('http://') || rel.sourceUrl.startsWith('https://'));
                  return (
                    <div 
                      key={rel.id} 
                      className="p-3.5 bg-gray-50 hover:bg-indigo-50/40 rounded-xl border border-gray-200/80 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
                    >
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`px-2.5 py-0.5 rounded-md text-xs font-bold border ${getQualityBadgeColor(rel.releaseType)}`}>
                            {rel.releaseType}
                          </span>
                          <span className="text-xs text-gray-500 font-medium flex items-center gap-1">
                            <Globe className="w-3 h-3" /> {rel.provider}
                          </span>
                          <span className="text-xs text-gray-400">
                            • {formatDistanceToNow(new Date(rel.createdAt), { addSuffix: true })}
                          </span>
                        </div>

                        <p className="text-xs font-mono text-gray-700 truncate group-hover:text-indigo-950 transition-colors">
                          {rel.title}
                        </p>
                      </div>

                      {isHttpUrl && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleCopyLink(rel)}
                            className="p-2 bg-white hover:bg-gray-100 text-gray-600 hover:text-gray-900 rounded-lg border border-gray-200 transition-colors text-xs flex items-center gap-1"
                            title="Copy Release URL"
                          >
                            {copiedId === rel.id ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                <span className="text-emerald-600 font-medium">Copied</span>
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
                            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
                          >
                            <span>Open Link</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
