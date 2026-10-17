import axios from 'axios';
import { db } from '../database/db';
import { discoveredReleases, releases } from '../database/schema';
import { getSettings } from './settings';
import { parseEpisodeInfo } from '../utils/episodeParser';
import { detectSeasonPack } from '../utils/seasonPack';
import { eq, like, or } from 'drizzle-orm';
import { filterIgnoredDownloads } from './ignoredDownloads';
import { calculateAirCountdown } from '../utils/countdownFormatter';

export interface EpisodeDetail {
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

export interface SeasonInfo {
  seasonNumber: number;
  name: string;
  episodeCount: number;
  airDate?: string;
  overview?: string;
  posterPath?: string;
}

export interface SeriesProgressResult {
  tmdbId: number;
  title: string;
  overview?: string;
  status: string; // Returning Series, Ended, etc.
  poster?: string;
  backdrop?: string;
  seasons: SeasonInfo[];
  selectedSeason: number;
  episodes: EpisodeDetail[];
  stats: {
    totalEpisodes: number;
    airedEpisodes: number;
    airedPercent: number;
    currentAiredEpisodeNumber: number;
    availableEpisodes: number;
    availablePercent: number;
    currentAvailableEpisodeNumber: number;
    percentComplete: number;
    hasSeasonPack: boolean;
    seasonPack?: {
      title: string;
      magnetUrl: string;
      seeders: number;
      quality: string;
      sizeText?: string;
    };
    nextAiringEpisode?: EpisodeDetail;
    broadcastSchedule?: {
      time?: string;
      days?: string[];
      network?: string;
    };
  };
}

export async function getSeriesEpisodesProgress(params: {
  tmdbId?: number;
  title: string;
  year?: number;
  seasonNumber?: number;
}): Promise<SeriesProgressResult | null> {
  const settings = await getSettings();
  const apiKey = settings?.metadataApiKey || process.env.TMDB_API_KEY;

  if (!apiKey) {
    console.warn('[EpisodeTracker] No TMDB API key available');
    return null;
  }

  let tmdbId = params.tmdbId;
  const cleanTitle = params.title.replace(/\s*\(\d{4}\)$/, '').trim();

  // 1. Resolve TMDB ID if missing
  if (!tmdbId) {
    try {
      const searchRes = await axios.get('https://api.themoviedb.org/3/search/tv', {
        params: {
          api_key: apiKey,
          query: cleanTitle,
          first_air_date_year: params.year || undefined
        },
        timeout: 6000
      });

      const first = searchRes.data?.results?.[0];
      if (first) {
        tmdbId = first.id;
      } else {
        // Fallback search without year
        const retryRes = await axios.get('https://api.themoviedb.org/3/search/tv', {
          params: { api_key: apiKey, query: cleanTitle },
          timeout: 6000
        });
        tmdbId = retryRes.data?.results?.[0]?.id;
      }
    } catch (e: any) {
      console.warn('[EpisodeTracker] Search TV failed:', e.message);
    }
  }

  if (!tmdbId) return null;

  // 2. Fetch Show Overview & Season List
  let showDetails: any = null;
  try {
    const showRes = await axios.get(`https://api.themoviedb.org/3/tv/${tmdbId}`, {
      params: { api_key: apiKey },
      timeout: 6000
    });
    showDetails = showRes.data;
  } catch (e: any) {
    console.warn('[EpisodeTracker] TV Details query failed:', e.message);
    return null;
  }

  const rawSeasons: any[] = Array.isArray(showDetails?.seasons) ? showDetails.seasons : [];
  // Filter out Specials (season 0) if user wants regular seasons, but keep if it's the only one
  const validSeasons: SeasonInfo[] = rawSeasons
    .filter(s => s.season_number > 0)
    .map(s => ({
      seasonNumber: s.season_number,
      name: s.name || `Season ${s.season_number}`,
      episodeCount: s.episode_count || 0,
      airDate: s.air_date,
      overview: s.overview,
      posterPath: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : undefined
    }));

  if (validSeasons.length === 0 && rawSeasons.length > 0) {
    validSeasons.push({
      seasonNumber: rawSeasons[0].season_number,
      name: rawSeasons[0].name,
      episodeCount: rawSeasons[0].episode_count,
      airDate: rawSeasons[0].air_date
    });
  }

  // Determine active season: default to requested season, or latest season
  let targetSeasonNum = params.seasonNumber;
  if (!targetSeasonNum || !validSeasons.some(s => s.seasonNumber === targetSeasonNum)) {
    targetSeasonNum = validSeasons[validSeasons.length - 1]?.seasonNumber || 1;
  }

  // 3. Fetch specific Season Episodes from TMDB
  let seasonEpisodesRaw: any[] = [];
  try {
    const seasonRes = await axios.get(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${targetSeasonNum}`, {
      params: { api_key: apiKey },
      timeout: 6000
    });
    seasonEpisodesRaw = Array.isArray(seasonRes.data?.episodes) ? seasonRes.data.episodes : [];
  } catch (e: any) {
    console.warn(`[EpisodeTracker] Season ${targetSeasonNum} query failed:`, e.message);
  }

  // 3b. Query TVmaze for exact broadcast schedule and episode timestamps
  let tvmazeEpisodes: any[] = [];
  let tvmazeNetworkName = '';
  let tvmazeScheduleTime = '';
  let tvmazeScheduleDays: string[] = [];
  try {
    const tvmazeRes = await axios.get('https://api.tvmaze.com/singlesearch/shows', {
      params: { q: cleanTitle, embed: ['episodes', 'nextepisode'] },
      timeout: 4500
    });
    if (tvmazeRes.data) {
      tvmazeNetworkName = tvmazeRes.data.network?.name || tvmazeRes.data.webChannel?.name || '';
      tvmazeScheduleTime = tvmazeRes.data.schedule?.time || '';
      tvmazeScheduleDays = Array.isArray(tvmazeRes.data.schedule?.days) ? tvmazeRes.data.schedule.days : [];
      if (Array.isArray(tvmazeRes.data._embedded?.episodes)) {
        tvmazeEpisodes = tvmazeRes.data._embedded.episodes;
      }
    }
  } catch (e: any) {
    // TVmaze broadcast schedule fallback
  }

  // 4. Gather local torrents from DB (discovered_releases & releases)
  const localReleases: any[] = [];
  try {
    const discMatches = await db.select().from(discoveredReleases);
    for (const d of discMatches) {
      if (d.title.toLowerCase().includes(cleanTitle.toLowerCase()) || cleanTitle.toLowerCase().includes(d.title.toLowerCase())) {
        if (Array.isArray(d.downloads)) {
          d.downloads.forEach(dl => {
            localReleases.push({
              title: dl.title || d.title,
              magnetUrl: dl.magnetUrl || dl.sourceUrl,
              seeders: dl.seeders || 0,
              quality: dl.quality || 'WEB-DL',
              sizeText: dl.sizeText,
              releaseType: dl.quality || 'WEB-DL'
            });
          });
        }
      }
    }
  } catch (e) {
    console.warn('[EpisodeTracker] Discovered DB lookup failed:', e);
  }

  try {
    const relMatches = await db.select().from(releases);
    for (const r of relMatches) {
      if (r.title.toLowerCase().includes(cleanTitle.toLowerCase()) || cleanTitle.toLowerCase().includes(r.title.toLowerCase())) {
        const meta = r.metadataJson as any;
        const subList = Array.isArray(meta?.allReleases) && meta.allReleases.length > 0
          ? meta.allReleases
          : (Array.isArray(meta?.downloads) && meta.downloads.length > 0 ? meta.downloads : []);

        if (subList.length > 0) {
          for (const sub of subList) {
            localReleases.push({
              title: sub.title || r.title,
              magnetUrl: sub.sourceUrl || sub.magnetUrl || r.sourceUrl,
              seeders: sub.seeders || 0,
              quality: sub.releaseType || sub.quality || r.releaseType || 'WEB-DL',
              sizeText: sub.sizeText || meta?.sizeText,
              releaseType: sub.releaseType || r.releaseType || 'WEB-DL'
            });
          }
        } else {
          localReleases.push({
            title: r.title,
            magnetUrl: r.sourceUrl,
            seeders: r.seeders || 0,
            quality: r.releaseType || 'WEB-DL',
            sizeText: meta?.sizeText,
            releaseType: r.releaseType || 'WEB-DL'
          });
        }
      }
    }
  } catch (e) {
    console.warn('[EpisodeTracker] Releases DB lookup failed:', e);
  }

  // Filter out any user-deleted or blacklisted downloads so fake downloads never mark episodes available
  const activeLocalReleases = await filterIgnoredDownloads(localReleases);

  // Check for season pack
  let seasonPackMatch: any = null;
  for (const rel of activeLocalReleases) {
    const pack = detectSeasonPack(rel.title);
    if (pack.isPack && pack.seasonNumber === targetSeasonNum) {
      if (!seasonPackMatch || (rel.seeders || 0) > (seasonPackMatch.seeders || 0)) {
        seasonPackMatch = {
          title: rel.title,
          magnetUrl: rel.magnetUrl,
          seeders: rel.seeders || 0,
          quality: rel.quality || 'WEB-DL',
          sizeText: rel.sizeText
        };
      }
    }
  }

  const todayStr = new Date().toISOString().split('T')[0];

  // 5. Correlate TMDB episodes with torrent releases
  const episodes: EpisodeDetail[] = seasonEpisodesRaw.map(ep => {
    const epNum = ep.episode_number;
    const sPad = String(targetSeasonNum).padStart(2, '0');
    const ePad = String(epNum).padStart(2, '0');
    const standardCode = `s${sPad}e${ePad}`;
    const altCode = `${targetSeasonNum}x${ePad}`;
    const epOnlyCode = `e${ePad}`;

    // Find all matching downloads for this episode
    const matchingDls = activeLocalReleases.filter(r => {
      const t = r.title.toLowerCase();
      // Match S06E05 or 6x05 or "Season 6 Episode 5" or episode title
      if (t.includes(standardCode) || t.includes(altCode)) return true;
      if (t.includes(`season ${targetSeasonNum}`) && (t.includes(`episode ${epNum}`) || t.includes(`ep ${epNum}`))) return true;
      if (ep.name && ep.name.length > 4 && t.includes(ep.name.toLowerCase())) return true;
      // If title includes show name and episode code
      if (t.includes(cleanTitle.toLowerCase()) && t.includes(standardCode)) return true;
      return false;
    });

    // Check for valid magnet URLs
    const validDls = matchingDls.filter(d => (d.magnetUrl && d.magnetUrl.startsWith('magnet:')) || (d.sourceUrl && d.sourceUrl.startsWith('magnet:')));

    // Episode is available if valid magnets exist or a verified full season pack exists
    const isAvail = validDls.length > 0 || (!!seasonPackMatch && !!seasonPackMatch.magnetUrl);
    const topSeed = matchingDls.reduce((max, d) => Math.max(max, d.seeders || 0), 0) || (seasonPackMatch?.seeders || 0);
    const qualities = Array.from(new Set(matchingDls.map(d => d.quality).filter(Boolean))) as string[];

    const airDate = ep.air_date || '';

    // Match with TVmaze episode for exact broadcast timestamp and schedule
    const tvmMatch = tvmazeEpisodes.find(
      (te: any) => te.season === targetSeasonNum && te.number === epNum
    ) || tvmazeEpisodes.find(
      (te: any) => te.airdate && ep.air_date && te.airdate === ep.air_date
    );

    let airTimestamp = tvmMatch?.airstamp;
    const airTime = tvmMatch?.airtime || tvmazeScheduleTime || '';

    // If TVmaze didn't have timestamp but we have air_date
    if (!airTimestamp && ep.air_date) {
      if (airTime) {
        airTimestamp = `${ep.air_date}T${airTime}:00-04:00`;
      } else {
        airTimestamp = `${ep.air_date}T20:00:00-04:00`;
      }
    }

    // Determine countdown and air status using calculateAirCountdown
    const countdown = calculateAirCountdown(airTimestamp, ep.air_date, isAvail);

    // Episode is considered aired if its air date/time passed or if torrents already leaked/dropped
    const isAired = countdown.isAired || isAvail;
    const isAiringToday = countdown.status === 'airing_today';
    const isUpcoming = countdown.status === 'upcoming';

    return {
      episodeNumber: epNum,
      seasonNumber: targetSeasonNum!,
      name: ep.name || `Episode ${epNum}`,
      overview: ep.overview,
      airDate: ep.air_date,
      airTime: airTime || undefined,
      airTimestamp: airTimestamp || undefined,
      network: tvmazeNetworkName || showDetails.networks?.[0]?.name,
      stillPath: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : undefined,
      voteAverage: ep.vote_average ? Math.round(ep.vote_average * 10) / 10 : undefined,
      isAired,
      isAvailable: isAvail,
      isAiringToday,
      isUpcoming,
      countdownText: countdown.countdownText,
      countdownBadge: countdown.badgeText,
      topSeeds: topSeed,
      topQuality: qualities[0] || (seasonPackMatch ? seasonPackMatch.quality : undefined),
      qualities: qualities.length > 0 ? qualities : (seasonPackMatch ? [seasonPackMatch.quality] : []),
      downloadsCount: validDls.length > 0 ? validDls.length : matchingDls.length,
      downloads: validDls.length > 0 ? validDls : matchingDls
    };
  });

  const totalCount = episodes.length;
  const airedCount = episodes.filter(e => e.isAired).length;
  const availableCount = episodes.filter(e => e.isAvailable).length;

  const airedPercent = totalCount > 0 ? Math.round((airedCount / totalCount) * 100) : 0;
  const availablePercent = totalCount > 0 ? Math.round((availableCount / totalCount) * 100) : 0;

  const airedEps = episodes.filter(e => e.isAired);
  const currentAiredEpisodeNumber = airedEps.length > 0 ? airedEps[airedEps.length - 1].episodeNumber : airedCount;

  const availEps = episodes.filter(e => e.isAvailable);
  const currentAvailableEpisodeNumber = availEps.length > 0 ? availEps[availEps.length - 1].episodeNumber : availableCount;

  const nextAiring = episodes.find(e => !e.isAired && (e.airTimestamp || e.airDate));

  return {
    tmdbId,
    title: showDetails.name || cleanTitle,
    overview: showDetails.overview,
    status: showDetails.status || 'Returning Series',
    poster: showDetails.poster_path ? `https://image.tmdb.org/t/p/w500${showDetails.poster_path}` : undefined,
    backdrop: showDetails.backdrop_path ? `https://image.tmdb.org/t/p/w1280${showDetails.backdrop_path}` : undefined,
    seasons: validSeasons,
    selectedSeason: targetSeasonNum,
    episodes,
    stats: {
      totalEpisodes: totalCount,
      airedEpisodes: airedCount,
      airedPercent,
      currentAiredEpisodeNumber,
      availableEpisodes: availableCount,
      availablePercent,
      currentAvailableEpisodeNumber,
      percentComplete: availablePercent,
      hasSeasonPack: !!seasonPackMatch,
      seasonPack: seasonPackMatch || undefined,
      nextAiringEpisode: nextAiring || undefined,
      broadcastSchedule: tvmazeScheduleTime ? {
        time: tvmazeScheduleTime,
        days: tvmazeScheduleDays,
        network: tvmazeNetworkName || showDetails.networks?.[0]?.name
      } : undefined
    }
  };
}
