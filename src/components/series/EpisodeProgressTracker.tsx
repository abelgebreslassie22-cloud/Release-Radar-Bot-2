import React, { useState, useEffect } from 'react';
import { 
  Tv, 
  Calendar, 
  CheckCircle2, 
  Clock, 
  Radio, 
  Magnet, 
  Copy, 
  Check, 
  ChevronDown, 
  ChevronUp, 
  Sparkles,
  Layers,
  HardDrive,
  ExternalLink,
  Film,
  RefreshCw,
  Flame,
  Info
} from 'lucide-react';
import { useToast } from '../ui/Toast';
import { useLiveAirCountdown } from '../../utils/countdownFormatter';

interface EpisodeDetail {
  episodeNumber: number;
  seasonNumber: number;
  name: string;
  overview?: string;
  airDate?: string;
  airTime?: string;
  airTimestamp?: string;
  network?: string;
  stillPath?: string;
  voteAverage?: number;
  isAired: boolean;
  isAvailable: boolean;
  isAiringToday: boolean;
  isUpcoming: boolean;
  countdownText?: string;
  countdownBadge?: string;
  topSeeds: number;
  topQuality?: string;
  qualities: string[];
  downloadsCount: number;
  downloads: any[];
}

interface SeasonInfo {
  seasonNumber: number;
  name: string;
  episodeCount: number;
  airDate?: string;
}

interface EpisodeProgressTrackerProps {
  seriesTitle: string;
  year?: number;
  tmdbId?: number;
  onFilterEpisode?: (episodeCode: string) => void;
}

/**
 * Top Badge for individual Episode Card
 * - If available: "Available (X seeds)"
 * - If aired (broadcast passed or downloaded): "Aired"
 * - If < 24 hours until air: "Airs in Xh Ym" or "Airs in Xm"
 * - If > 1 day until air: "In X days" or "In 1 day"
 */
function EpisodeCountdownBadge({ ep }: { ep: EpisodeDetail }) {
  const cd = useLiveAirCountdown(ep.airTimestamp, ep.airDate, ep.isAvailable, ep.isAired);

  if (ep.isAvailable) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
        <span>Available</span>
        {ep.topSeeds > 0 && <span className="opacity-75 font-normal">({ep.topSeeds}s)</span>}
      </span>
    );
  }

  if (cd.isAired) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full border border-sky-200">
        <CheckCircle2 className="w-3 h-3 text-sky-600" />
        <span>Aired</span>
      </span>
    );
  }

  // Less than a day: uses time, minute till it aired
  if (cd.diffMs > 0 && cd.diffMs < 24 * 60 * 60 * 1000) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-100/90 px-2.5 py-0.5 rounded-full border border-amber-300 shadow-xs">
        <Clock className="w-3 h-3 text-amber-600 animate-pulse" />
        <span>{cd.countdownText}</span>
      </span>
    );
  }

  // More than a day: uses day
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
      <Calendar className="w-3 h-3 text-slate-500" />
      <span>{cd.countdownText}</span>
    </span>
  );
}

/**
 * Footer row for Episode Card
 */
function EpisodeCountdownFooter({ 
  ep, 
  topDl, 
  copiedEp, 
  handleCopyMagnet, 
  onFilterEpisode, 
  epCode 
}: {
  ep: EpisodeDetail;
  topDl: any;
  copiedEp: number | null;
  handleCopyMagnet: (e: React.MouseEvent, magnetUrl: string, epNum: number) => void;
  onFilterEpisode?: (episodeCode: string) => void;
  epCode: string;
}) {
  const cd = useLiveAirCountdown(ep.airTimestamp, ep.airDate, ep.isAvailable, ep.isAired);

  return (
    <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
      {ep.isAvailable && topDl ? (
        <button
          type="button"
          onClick={(e) => handleCopyMagnet(e, topDl.magnetUrl || topDl.sourceUrl, ep.episodeNumber)}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-semibold transition-colors cursor-pointer"
          title="Copy magnet link for this episode"
        >
          {copiedEp === ep.episodeNumber ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>Copied!</span>
            </>
          ) : (
            <>
              <Magnet className="w-3.5 h-3.5 text-emerald-600" />
              <span>Copy Magnet</span>
            </>
          )}
        </button>
      ) : cd.isAired ? (
        <div className="text-[11px] text-sky-700 font-medium flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
          <span>Aired • Checking indexers for releases</span>
        </div>
      ) : cd.diffMs > 0 && cd.diffMs < 24 * 60 * 60 * 1000 ? (
        <div className="text-[11px] text-amber-700 font-medium flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          <span>{cd.countdownText} • Auto-monitored</span>
        </div>
      ) : (
        <div className="text-[11px] text-gray-500 flex items-center gap-1">
          <Calendar className="w-3 h-3 text-gray-400" />
          <span>Airs {ep.airDate} ({cd.countdownText})</span>
        </div>
      )}

      {onFilterEpisode && ep.isAvailable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onFilterEpisode(epCode);
          }}
          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2 py-1 rounded-lg hover:bg-indigo-50 transition-colors"
          title="View releases for this episode"
        >
          Filter Releases
        </button>
      )}
    </div>
  );
}

/**
 * Prominent Spotlight Banner for the Next Upcoming Episode
 */
function NextAiringSpotlight({ nextEp, schedule }: { nextEp: EpisodeDetail; schedule?: any }) {
  const cd = useLiveAirCountdown(nextEp.airTimestamp, nextEp.airDate, nextEp.isAvailable, nextEp.isAired);

  const sPad = String(nextEp.seasonNumber).padStart(2, '0');
  const ePad = String(nextEp.episodeNumber).padStart(2, '0');
  const epCode = `S${sPad}E${ePad}`;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500/10 via-indigo-500/10 to-sky-500/10 border border-amber-200/80 p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="flex items-start sm:items-center gap-3.5">
        <div className="w-11 h-11 rounded-2xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-sm">
          <Clock className="w-6 h-6 animate-pulse" />
        </div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono font-bold bg-amber-100 text-amber-900 px-2 py-0.5 rounded-md border border-amber-200">
              Next to Air: {epCode}
            </span>
            {nextEp.network && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-white/80 text-gray-700 border border-gray-200">
                {nextEp.network}
              </span>
            )}
            {schedule?.days && schedule.days.length > 0 && (
              <span className="text-xs text-gray-500 font-medium">
                {schedule.days.join(', ')} {schedule.time ? `at ${schedule.time}` : ''}
              </span>
            )}
          </div>
          <h4 className="text-sm sm:text-base font-bold text-gray-900 mt-1">
            {nextEp.name}
          </h4>
          <p className="text-xs text-gray-600 mt-0.5">
            Official Broadcast Date: <span className="font-semibold text-gray-800">{nextEp.airDate}</span>
            {nextEp.airTime ? ` at ${nextEp.airTime}` : ''}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 self-start md:self-auto shrink-0">
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wider font-bold text-gray-500">
            Broadcast Countdown
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-sm bg-white shadow-xs border border-amber-200/80 mt-1">
            {cd.isAired ? (
              <span className="text-sky-700 flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4 text-sky-600" /> Aired
              </span>
            ) : cd.diffMs > 0 && cd.diffMs < 24 * 60 * 60 * 1000 ? (
              <span className="text-amber-800 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                {cd.countdownText}
              </span>
            ) : (
              <span className="text-indigo-800 flex items-center gap-1">
                <Calendar className="w-4 h-4 text-indigo-600" />
                {cd.countdownText}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function EpisodeProgressTracker({
  seriesTitle,
  year,
  tmdbId,
  onFilterEpisode
}: EpisodeProgressTrackerProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [expandedEpisode, setExpandedEpisode] = useState<number | null>(null);
  const [copiedEp, setCopiedEp] = useState<number | null>(null);
  const [copiedPack, setCopiedPack] = useState(false);
  const { addToast } = useToast();

  const fetchSeasonProgress = (seasonNum?: number) => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('title', seriesTitle);
    if (year) params.set('year', String(year));
    if (tmdbId) params.set('tmdbId', String(tmdbId));
    if (seasonNum) params.set('season', String(seasonNum));

    fetch(`/api/series/episodes?${params.toString()}`)
      .then(res => res.json())
      .then(resData => {
        if (!resData.error) {
          setData(resData);
          if (resData.selectedSeason) {
            setSelectedSeason(resData.selectedSeason);
          }
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchSeasonProgress();
  }, [seriesTitle, year, tmdbId]);

  const handleSeasonChange = (sNum: number) => {
    setSelectedSeason(sNum);
    fetchSeasonProgress(sNum);
  };

  const handleCopyMagnet = (e: React.MouseEvent, magnetUrl: string, epNum: number) => {
    e.stopPropagation();
    navigator.clipboard.writeText(magnetUrl);
    setCopiedEp(epNum);
    addToast({
      title: 'Magnet Copied!',
      description: `Magnet link for Episode ${epNum} copied to clipboard.`,
      variant: 'success'
    });
    setTimeout(() => setCopiedEp(null), 2500);
  };

  const handleCopyPackMagnet = (e: React.MouseEvent, magnetUrl: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(magnetUrl);
    setCopiedPack(true);
    addToast({
      title: 'Season Pack Magnet Copied!',
      description: `Complete season batch magnet link copied to clipboard.`,
      variant: 'success'
    });
    setTimeout(() => setCopiedPack(false), 2500);
  };

  if (loading && !data) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-6 animate-pulse space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-5 bg-gray-200 rounded w-48" />
          <div className="h-4 bg-gray-100 rounded w-24" />
        </div>
        <div className="h-2.5 bg-gray-100 rounded-full w-full" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-20 bg-gray-50 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!data || !data.episodes || data.episodes.length === 0) {
    return (
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8 text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
          <Tv className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-bold text-gray-900">Episode Availability Schedule</h3>
        <p className="text-gray-500 text-sm max-w-md mx-auto">
          No broadcast episode schedule found for "{seriesTitle}". If this is a movie or documentary, torrent downloads are listed in the Releases tab. If this is a TV series, click retry below.
        </p>
        <button
          onClick={() => fetchSeasonProgress()}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry TV Airing Query
        </button>
      </div>
    );
  }

  const { seasons, episodes, stats } = data;
  const currentSeason = selectedSeason || data.selectedSeason || 1;
  const totalEpisodes = stats.totalEpisodes || episodes.length || 0;
  const airedCount = stats.airedEpisodes !== undefined ? stats.airedEpisodes : episodes.filter((e: any) => e.isAired).length;
  const availableCount = stats.availableEpisodes !== undefined ? stats.availableEpisodes : episodes.filter((e: any) => e.isAvailable).length;

  const airedPercent = totalEpisodes > 0 ? Math.min(100, Math.round((airedCount / totalEpisodes) * 100)) : 0;
  const availablePercent = totalEpisodes > 0 ? Math.min(100, Math.round((availableCount / totalEpisodes) * 100)) : 0;
  const currentAiredEpNum = stats.currentAiredEpisodeNumber || airedCount;

  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 sm:p-8 space-y-6">
      {/* Header and Season Picker */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <Tv className="w-5 h-5 text-indigo-600" />
            <h3 className="text-lg font-bold text-gray-900 tracking-tight">
              Episode Availability Matrix
            </h3>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700">
              {data.status}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Real-time availability of TV episodes and verified torrent magnet links matched against official air dates.
          </p>
        </div>

        {/* Season Selector Tabs */}
        {seasons && seasons.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full no-scrollbar">
            {seasons.map((s: SeasonInfo) => (
              <button
                key={s.seasonNumber}
                onClick={() => handleSeasonChange(s.seasonNumber)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  currentSeason === s.seasonNumber
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
              >
                {s.name || `Season ${s.seasonNumber}`}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Spotlight: Next Upcoming Episode with Live Countdown */}
      {stats.nextAiringEpisode && (
        <NextAiringSpotlight 
          nextEp={stats.nextAiringEpisode} 
          schedule={stats.broadcastSchedule} 
        />
      )}

      {/* Dual Progress Bars: Broadcast Airing Progress vs Torrent/Magnet Availability */}
      <div className="bg-gray-50/80 rounded-2xl p-4 sm:p-5 border border-gray-100 space-y-4">
        {/* Progress Bar 1: Season Airing Progress */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-gray-800 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-sky-500" />
              <span>Broadcast Airing Progress:</span>
              <span className="text-gray-500 font-normal">
                Episode {currentAiredEpNum} of {totalEpisodes} Aired
              </span>
            </span>
            <span className="font-bold text-sky-700 bg-sky-100/80 px-2 py-0.5 rounded-md">
              {airedPercent}% Aired
            </span>
          </div>

          <div className="h-2.5 w-full bg-gray-200/70 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-sky-500 to-indigo-600 transition-all duration-500 rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, airedPercent))}%` }}
            />
          </div>
        </div>

        {/* Progress Bar 2: Torrent & Magnet Availability */}
        <div className="space-y-1.5 pt-2 border-t border-gray-200/60">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-gray-800 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>Torrent & Magnet Availability:</span>
              <span className="text-gray-500 font-normal">
                {availableCount} of {totalEpisodes} Episodes Downloadable
              </span>
            </span>
            <span className="font-bold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-md">
              {availablePercent}% Downloadable
            </span>
          </div>

          <div className="h-2.5 w-full bg-gray-200/70 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-500 rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, availablePercent))}%` }}
            />
          </div>
        </div>

        {/* Status helper text */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500 pt-1">
          <span>
            {availableCount === airedCount
              ? '✓ 100% of currently aired episodes have verified torrent magnets.'
              : `${Math.max(0, airedCount - availableCount)} aired episode(s) waiting for torrent uploads.`}
          </span>
          <span className="font-medium text-gray-700">
            Season {currentSeason} • {totalEpisodes} Episodes Total
          </span>
        </div>
      </div>

      {/* Season Pack Banner (If available) */}
      {stats.hasSeasonPack && stats.seasonPack && (
        <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-700">Complete Season Batch</span>
                <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                  {stats.seasonPack.seeders} Seeds
                </span>
                {stats.seasonPack.quality && (
                  <span className="text-xs font-medium text-gray-500">{stats.seasonPack.quality}</span>
                )}
              </div>
              <p className="text-xs text-gray-700 font-medium truncate max-w-md sm:max-w-lg mt-0.5">
                {stats.seasonPack.title}
              </p>
            </div>
          </div>

          <button
            onClick={(e) => handleCopyPackMagnet(e, stats.seasonPack.magnetUrl)}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors shrink-0 cursor-pointer"
          >
            {copiedPack ? (
              <>
                <Check className="w-4 h-4 text-emerald-300" />
                <span>Pack Copied!</span>
              </>
            ) : (
              <>
                <Magnet className="w-4 h-4" />
                <span>Copy Season Pack</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Episode Grid Matrix */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {episodes.map((ep: EpisodeDetail) => {
          const sPad = String(ep.seasonNumber).padStart(2, '0');
          const ePad = String(ep.episodeNumber).padStart(2, '0');
          const epCode = `S${sPad}E${ePad}`;
          const isExpanded = expandedEpisode === ep.episodeNumber;
          const topDl = ep.downloads[0];

          return (
            <div 
              key={ep.episodeNumber}
              onClick={() => onFilterEpisode && onFilterEpisode(epCode)}
              className={`rounded-2xl border transition-all duration-200 p-4 flex flex-col justify-between relative cursor-pointer ${
                ep.isAvailable
                  ? 'bg-white border-gray-200/90 hover:border-indigo-300 hover:shadow-md'
                  : ep.isAired
                  ? 'bg-sky-50/30 border-sky-200 hover:border-sky-300 hover:shadow-xs'
                  : ep.isAiringToday
                  ? 'bg-amber-50/50 border-amber-200 hover:border-amber-300'
                  : 'bg-gray-50/70 border-gray-200/50 opacity-80'
              }`}
            >
              <div>
                {/* Top Badge Row */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-mono font-bold text-gray-900 bg-gray-100 px-2 py-0.5 rounded-lg border border-gray-200/60">
                    {epCode}
                  </span>

                  {/* Status Indicator with Live Countdown Badge */}
                  <EpisodeCountdownBadge ep={ep} />
                </div>

                {/* Episode Title */}
                <h4 className="font-bold text-sm text-gray-900 leading-snug line-clamp-1" title={ep.name}>
                  {ep.name}
                </h4>

                {/* Air Date / Details */}
                <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                  {ep.airDate && (
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-gray-400" />
                      {ep.airDate}
                    </span>
                  )}
                  {ep.airTime && (
                    <>
                      <span>•</span>
                      <span className="text-gray-600">{ep.airTime}</span>
                    </>
                  )}
                  {ep.topQuality && (
                    <>
                      <span>•</span>
                      <span className="text-gray-700 font-medium">{ep.topQuality}</span>
                    </>
                  )}
                </div>

                {/* Overview preview */}
                {ep.overview && (
                  <div className="mt-2 text-xs text-gray-600">
                    <p className={isExpanded ? 'leading-relaxed' : 'line-clamp-2 leading-relaxed'}>
                      {ep.overview}
                    </p>
                    {ep.overview.length > 90 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedEpisode(isExpanded ? null : ep.episodeNumber);
                        }}
                        className="text-[11px] text-indigo-600 hover:text-indigo-700 font-semibold mt-1 inline-flex items-center gap-0.5"
                      >
                        {isExpanded ? (
                          <><span>Less</span> <ChevronUp className="w-3 h-3" /></>
                        ) : (
                          <><span>More</span> <ChevronDown className="w-3 h-3" /></>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Bottom Actions & Countdown Footer */}
              <EpisodeCountdownFooter
                ep={ep}
                topDl={topDl}
                copiedEp={copiedEp}
                handleCopyMagnet={handleCopyMagnet}
                onFilterEpisode={onFilterEpisode}
                epCode={epCode}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
