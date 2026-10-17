import axios from 'axios';
import { db } from '../database/db';
import { discoveredReleases, releases, watchlist } from '../database/schema';
import { getSettings } from './settings';
import { parseEpisodeInfo } from '../utils/episodeParser';

export interface CalendarDropItem {
  id: string;
  tmdbId?: number;
  title: string;
  episodeCode?: string; // e.g. S06E05
  episodeTitle?: string;
  year: number;
  type: string; // Series, Movie, Anime, Animation
  category: string;
  poster?: string;
  backdrop?: string;
  overview?: string;
  airDate: string; // YYYY-MM-DD
  status: 'available' | 'airing_today' | 'upcoming';
  countdownText: string;
  seeders?: number;
  topQuality?: string;
  qualities?: string[];
  magnetUrl?: string;
  inWatchlist: boolean;
  groupKey: string;
  originCountry?: string;
}

export interface CalendarDayGroup {
  date: string; // YYYY-MM-DD
  dayOfWeek: string; // Monday, Tuesday...
  shortDay: string; // Mon, Tue...
  formattedDate: string; // Oct 14
  isToday: boolean;
  isPast: boolean;
  isFuture: boolean;
  drops: CalendarDropItem[];
}

// In-memory cache for calendar schedule to ensure fast responses and avoid TMDB rate limits
interface CacheEntry {
  timestamp: number;
  data: any;
}
const calendarCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getCalendarSchedule(options: {
  daysPast?: number;
  daysAhead?: number;
  category?: string;
  watchlistOnly?: boolean;
}): Promise<{
  today: string;
  startDate: string;
  endDate: string;
  days: CalendarDayGroup[];
  totalDrops: number;
  todayDropsCount: number;
  availableCount: number;
}> {
  const daysPast = options.daysPast ?? 2;
  const daysAhead = options.daysAhead ?? 12;
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  const startDateObj = new Date(now.getTime() - daysPast * 24 * 60 * 60 * 1000);
  const endDateObj = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const startDateStr = startDateObj.toISOString().split('T')[0];
  const endDateStr = endDateObj.toISOString().split('T')[0];

  const cacheKey = `${options.category || 'All'}_${options.watchlistOnly ? 'wl' : 'all'}_${daysPast}_${daysAhead}`;
  const cached = calendarCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const settings = await getSettings();
  const apiKey = settings?.metadataApiKey || process.env.TMDB_API_KEY;

  // 1. Fetch user watchlist
  let watchlistTitles = new Set<string>();
  let watchlistItems: any[] = [];
  try {
    watchlistItems = await db.select().from(watchlist);
    watchlistItems.forEach(w => watchlistTitles.add(w.title.toLowerCase().trim()));
  } catch (e) {
    console.warn('[Calendar] Watchlist read failed:', e);
  }

  // 2. Fetch existing discovered releases with downloads
  let localDiscovered: any[] = [];
  try {
    localDiscovered = await db.select().from(discoveredReleases);
  } catch (e) {
    console.warn('[Calendar] Discovered releases read failed:', e);
  }

  // Map of title lower -> discovered release
  const discoveredMap = new Map<string, any>();
  for (const disc of localDiscovered) {
    discoveredMap.set(disc.title.toLowerCase().trim(), disc);
  }

  // Also collect local torrents from DB releases table (unpacking allReleases)
  const localTorrentsMap = new Map<string, any[]>();
  try {
    const allRels = await db.select().from(releases);
    for (const r of allRels) {
      const meta = r.metadataJson as any;
      const subList = Array.isArray(meta?.allReleases) && meta.allReleases.length > 0
        ? meta.allReleases
        : (Array.isArray(meta?.downloads) && meta.downloads.length > 0 ? meta.downloads : []);

      const listToAdd = subList.length > 0 ? subList : [r];
      for (const item of listToAdd) {
        const titleKey = (r.title || '').toLowerCase().trim();
        const existing = localTorrentsMap.get(titleKey) || [];
        existing.push({
          title: item.title || r.title,
          magnetUrl: item.sourceUrl || item.magnetUrl || r.sourceUrl,
          seeders: item.seeders || 0,
          quality: item.releaseType || item.quality || r.releaseType || 'WEB-DL',
          sizeText: item.sizeText || meta?.sizeText
        });
        localTorrentsMap.set(titleKey, existing);
      }
    }
  } catch (e) {
    console.warn('[Calendar] Releases lookup failed:', e);
  }

  // Helper to format countdown text
  const getCountdown = (targetDateStr: string): string => {
    if (targetDateStr === todayStr) return 'Airing Today';
    const target = new Date(targetDateStr + 'T12:00:00Z');
    const today = new Date(todayStr + 'T12:00:00Z');
    const diffDays = Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';
    if (diffDays > 1) return `In ${diffDays} days`;
    if (diffDays < -1) return `${Math.abs(diffDays)} days ago`;
    return 'Today';
  };

  // Drops map by date
  const dropsByDate = new Map<string, CalendarDropItem[]>();

  // Helper to match torrent magnet for an episode or movie
  const findLocalTorrent = (title: string, epCode?: string) => {
    const cleanT = title.toLowerCase().trim();
    // 1. Check discovered releases
    const disc = discoveredMap.get(cleanT);
    if (disc && Array.isArray(disc.downloads) && disc.downloads.length > 0) {
      if (epCode) {
        const epMatch = disc.downloads.find((d: any) => (d.title || '').toLowerCase().includes(epCode.toLowerCase()));
        if (epMatch) return epMatch;
      }
      return disc.downloads[0];
    }

    // 2. Check releases table
    const rels = localTorrentsMap.get(cleanT);
    if (rels && rels.length > 0) {
      if (epCode) {
        const epMatch = rels.find((r: any) => (r.title || '').toLowerCase().includes(epCode.toLowerCase()));
        if (epMatch) return epMatch;
      }
      return rels[0];
    }

    return null;
  };

  // Add item to date bucket
  const addDrop = (item: CalendarDropItem) => {
    if (options.watchlistOnly && !item.inWatchlist) return;
    if (options.category && options.category !== 'All') {
      const cat = options.category.toLowerCase();
      const itemCat = item.category.toLowerCase();
      const itemType = item.type.toLowerCase();
      if (cat === 'series' && !(itemCat === 'series' || itemType === 'series' || itemType === 'tv')) return;
      if (cat === 'movies' && !(itemCat === 'movie' || itemType === 'movie')) return;
      if (cat === 'anime' && !(itemCat === 'anime' || itemType === 'anime')) return;
      if (cat === 'animation' && !(itemCat === 'animation' || itemType === 'animation')) return;
    }

    // Check if within window
    if (item.airDate < startDateStr || item.airDate > endDateStr) return;

    const current = dropsByDate.get(item.airDate) || [];
    // Prevent duplicate entries for same title and episode on same date
    const exists = current.some(d => 
      d.title.toLowerCase() === item.title.toLowerCase() && 
      (d.episodeCode === item.episodeCode || (!d.episodeCode && !item.episodeCode))
    );
    if (!exists) {
      current.push(item);
      dropsByDate.set(item.airDate, current);
    }
  };

  // A. Local discovered releases with verified magnet downloads
  for (const disc of localDiscovered) {
    const rawDate = disc.releaseDate || disc.createdAt?.toISOString().split('T')[0];
    if (rawDate && rawDate >= startDateStr && rawDate <= endDateStr) {
      const dls = Array.isArray(disc.downloads) ? disc.downloads : [];
      const topSeeds = disc.topSeeds || (dls[0]?.seeders || 0);
      const qualities = Array.from(new Set(dls.map((d: any) => d.quality).filter(Boolean))) as string[];
      const topMagnet = dls[0]?.magnetUrl || dls[0]?.sourceUrl;

      const epParsed = parseEpisodeInfo(disc.title, '');
      const epCode = epParsed.hasEpisode ? epParsed.code : undefined;

      addDrop({
        id: `disc_${disc.id}`,
        tmdbId: disc.tmdbId,
        title: disc.title,
        episodeCode: epCode,
        year: disc.year,
        type: disc.type || 'Series',
        category: disc.category || disc.type || 'Series',
        poster: disc.poster,
        backdrop: disc.backdrop,
        overview: disc.overview,
        airDate: rawDate,
        status: topSeeds > 0 ? 'available' : (rawDate === todayStr ? 'airing_today' : (rawDate > todayStr ? 'upcoming' : 'available')),
        countdownText: topSeeds > 0 ? `Available (${topSeeds.toLocaleString()} seeds)` : getCountdown(rawDate),
        seeders: topSeeds,
        topQuality: qualities[0] || '1080p',
        qualities,
        magnetUrl: topMagnet,
        inWatchlist: watchlistTitles.has(disc.title.toLowerCase().trim()),
        groupKey: `discover_${disc.id}`,
        originCountry: disc.originCountry
      });
    }
  }

  // B. TMDB Queries for TV and Movies
  if (apiKey) {
    try {
      // Run queries in parallel: on_the_air (week 1), airing_today, anime, week 2 discover, and movies (2 pages)
      const [onAir1, onAir2, airingTodayRes, animeRes, week2TvRes, mov1Res, mov2Res] = await Promise.all([
        axios.get('https://api.themoviedb.org/3/tv/on_the_air', { params: { api_key: apiKey, page: 1 }, timeout: 5000 }).catch(() => ({ data: { results: [] } })),
        axios.get('https://api.themoviedb.org/3/tv/on_the_air', { params: { api_key: apiKey, page: 2 }, timeout: 5000 }).catch(() => ({ data: { results: [] } })),
        axios.get('https://api.themoviedb.org/3/tv/airing_today', { params: { api_key: apiKey, page: 1 }, timeout: 5000 }).catch(() => ({ data: { results: [] } })),
        axios.get('https://api.themoviedb.org/3/discover/tv', {
          params: {
            api_key: apiKey,
            with_genres: 16,
            with_original_language: 'ja',
            'air_date.gte': startDateStr,
            'air_date.lte': endDateStr,
            sort_by: 'popularity.desc'
          },
          timeout: 5000
        }).catch(() => ({ data: { results: [] } })),
        axios.get('https://api.themoviedb.org/3/discover/tv', {
          params: {
            api_key: apiKey,
            'air_date.gte': new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0],
            'air_date.lte': endDateStr,
            sort_by: 'popularity.desc',
            page: 1
          },
          timeout: 5000
        }).catch(() => ({ data: { results: [] } })),
        axios.get('https://api.themoviedb.org/3/discover/movie', {
          params: {
            api_key: apiKey,
            'primary_release_date.gte': startDateStr,
            'primary_release_date.lte': endDateStr,
            sort_by: 'popularity.desc',
            page: 1
          },
          timeout: 5000
        }).catch(() => ({ data: { results: [] } })),
        axios.get('https://api.themoviedb.org/3/discover/movie', {
          params: {
            api_key: apiKey,
            'primary_release_date.gte': startDateStr,
            'primary_release_date.lte': endDateStr,
            sort_by: 'popularity.desc',
            page: 2
          },
          timeout: 5000
        }).catch(() => ({ data: { results: [] } }))
      ]);

      // Collect unique TV shows
      const uniqueTvShows = new Map<number, any>();
      const rawTvList = [
        ...(onAir1.data.results || []),
        ...(onAir2.data.results || []),
        ...(airingTodayRes.data.results || []),
        ...(animeRes.data.results || []),
        ...(week2TvRes.data.results || [])
      ];

      for (const show of rawTvList) {
        if (show && show.id && !uniqueTvShows.has(show.id)) {
          uniqueTvShows.set(show.id, show);
        }
      }

      // Query TV show details in parallel (limit to top 42 shows for speed)
      const selectedTvShows = Array.from(uniqueTvShows.values()).slice(0, 42);
      const tvDetailsList = await Promise.all(
        selectedTvShows.map(show =>
          axios.get(`https://api.themoviedb.org/3/tv/${show.id}`, {
            params: { api_key: apiKey },
            timeout: 3500
          })
          .then(r => r.data)
          .catch(() => null)
        )
      );

      // Process TV Episodes with exact dates
      for (const d of tvDetailsList) {
        if (!d) continue;

        const genres = Array.isArray(d.genres) ? d.genres.map((g: any) => g.id) : [];
        const isAnime = (genres.includes(16) && d.original_language === 'ja') || d.origin_country?.includes('JP');
        const isAnimation = genres.includes(16) && !isAnime;
        const category = isAnime ? 'Anime' : (isAnimation ? 'Animation' : 'Series');

        const localDisc = discoveredMap.get(d.name.toLowerCase().trim());
        const groupKey = localDisc ? `discover_${localDisc.id}` : `${d.name}_${new Date(d.first_air_date || '').getFullYear() || 2026}`;

        // 1. Next Episode
        if (d.next_episode_to_air && d.next_episode_to_air.air_date) {
          const ep = d.next_episode_to_air;
          const airDate = ep.air_date;
          const sPad = String(ep.season_number).padStart(2, '0');
          const ePad = String(ep.episode_number).padStart(2, '0');
          const epCode = `S${sPad}E${ePad}`;

          const localMatch = findLocalTorrent(d.name, epCode);
          const topSeeds = localMatch?.seeders || 0;
          const topMagnet = localMatch?.magnetUrl || localMatch?.sourceUrl;
          const qualities = localMatch?.quality ? [localMatch.quality] : [];

          addDrop({
            id: `tmdb_ep_${ep.id}`,
            tmdbId: d.id,
            title: d.name,
            episodeCode: epCode,
            episodeTitle: ep.name,
            year: new Date(d.first_air_date || airDate).getFullYear(),
            type: 'Series',
            category,
            poster: d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : localDisc?.poster,
            backdrop: d.backdrop_path ? `https://image.tmdb.org/t/p/w1280${d.backdrop_path}` : localDisc?.backdrop,
            overview: ep.overview || d.overview,
            airDate,
            status: topSeeds > 0 ? 'available' : (airDate === todayStr ? 'airing_today' : (airDate > todayStr ? 'upcoming' : 'available')),
            countdownText: topSeeds > 0 ? `Available (${topSeeds.toLocaleString()} seeds)` : getCountdown(airDate),
            seeders: topSeeds,
            topQuality: qualities[0] || '1080p',
            qualities,
            magnetUrl: topMagnet,
            inWatchlist: watchlistTitles.has(d.name.toLowerCase().trim()),
            groupKey,
            originCountry: d.origin_country?.[0] || 'US'
          });

          // If the show is weekly and this next episode is within 7 days, also project the subsequent weekly episode!
          const nextDateObj = new Date(airDate + 'T12:00:00Z');
          const subsequentDateObj = new Date(nextDateObj.getTime() + 7 * 86400000);
          const subsequentDateStr = subsequentDateObj.toISOString().split('T')[0];

          if (subsequentDateStr <= endDateStr) {
            const nextEPad = String(ep.episode_number + 1).padStart(2, '0');
            const nextEpCode = `S${sPad}E${nextEPad}`;
            addDrop({
              id: `tmdb_ep_proj_${d.id}_${nextEpCode}`,
              tmdbId: d.id,
              title: d.name,
              episodeCode: nextEpCode,
              year: new Date(d.first_air_date || airDate).getFullYear(),
              type: 'Series',
              category,
              poster: d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : localDisc?.poster,
              backdrop: d.backdrop_path ? `https://image.tmdb.org/t/p/w1280${d.backdrop_path}` : localDisc?.backdrop,
              overview: d.overview,
              airDate: subsequentDateStr,
              status: 'upcoming',
              countdownText: getCountdown(subsequentDateStr),
              seeders: 0,
              topQuality: '1080p',
              qualities: [],
              inWatchlist: watchlistTitles.has(d.name.toLowerCase().trim()),
              groupKey,
              originCountry: d.origin_country?.[0] || 'US'
            });
          }
        }

        // 2. Last Episode (if within window)
        if (d.last_episode_to_air && d.last_episode_to_air.air_date) {
          const ep = d.last_episode_to_air;
          const airDate = ep.air_date;
          if (airDate >= startDateStr && airDate <= endDateStr) {
            const sPad = String(ep.season_number).padStart(2, '0');
            const ePad = String(ep.episode_number).padStart(2, '0');
            const epCode = `S${sPad}E${ePad}`;

            const localMatch = findLocalTorrent(d.name, epCode);
            const topSeeds = localMatch?.seeders || 0;
            const topMagnet = localMatch?.magnetUrl || localMatch?.sourceUrl;
            const qualities = localMatch?.quality ? [localMatch.quality] : [];

            addDrop({
              id: `tmdb_ep_${ep.id}`,
              tmdbId: d.id,
              title: d.name,
              episodeCode: epCode,
              episodeTitle: ep.name,
              year: new Date(d.first_air_date || airDate).getFullYear(),
              type: 'Series',
              category,
              poster: d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : localDisc?.poster,
              backdrop: d.backdrop_path ? `https://image.tmdb.org/t/p/w1280${d.backdrop_path}` : localDisc?.backdrop,
              overview: ep.overview || d.overview,
              airDate,
              status: topSeeds > 0 ? 'available' : (airDate === todayStr ? 'airing_today' : (airDate > todayStr ? 'upcoming' : 'available')),
              countdownText: topSeeds > 0 ? `Available (${topSeeds.toLocaleString()} seeds)` : getCountdown(airDate),
              seeders: topSeeds,
              topQuality: qualities[0] || '1080p',
              qualities,
              magnetUrl: topMagnet,
              inWatchlist: watchlistTitles.has(d.name.toLowerCase().trim()),
              groupKey,
              originCountry: d.origin_country?.[0] || 'US'
            });
          }
        }
      }

      // Process Movies
      const allMovies = [...(mov1Res.data.results || []), ...(mov2Res.data.results || [])];
      for (const movie of allMovies) {
        if (!movie || !movie.title || !movie.release_date) continue;
        const releaseDate = movie.release_date;
        if (releaseDate < startDateStr || releaseDate > endDateStr) continue;

        const localDisc = discoveredMap.get(movie.title.toLowerCase().trim());
        const localMatch = findLocalTorrent(movie.title);
        const topSeeds = localMatch?.seeders || (localDisc?.topSeeds || 0);
        const topMagnet = localMatch?.magnetUrl || localMatch?.sourceUrl || localDisc?.downloads?.[0]?.magnetUrl;
        const qualities = localMatch?.quality ? [localMatch.quality] : (localDisc?.downloads ? localDisc.downloads.map((d: any) => d.quality) : []);

        const isAnimation = Array.isArray(movie.genre_ids) && movie.genre_ids.includes(16);
        const category = isAnimation ? 'Animation' : 'Movie';

        addDrop({
          id: `tmdb_mov_${movie.id}`,
          tmdbId: movie.id,
          title: movie.title,
          year: new Date(movie.release_date).getFullYear(),
          type: 'Movie',
          category,
          poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : localDisc?.poster,
          backdrop: movie.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` : localDisc?.backdrop,
          overview: movie.overview || localDisc?.overview,
          airDate: releaseDate,
          status: topSeeds > 0 ? 'available' : (releaseDate === todayStr ? 'airing_today' : (releaseDate > todayStr ? 'upcoming' : 'available')),
          countdownText: topSeeds > 0 ? `Available (${topSeeds.toLocaleString()} seeds)` : getCountdown(releaseDate),
          seeders: topSeeds,
          topQuality: qualities[0] || '1080p',
          qualities,
          magnetUrl: topMagnet,
          inWatchlist: watchlistTitles.has(movie.title.toLowerCase().trim()),
          groupKey: localDisc ? `discover_${localDisc.id}` : `${movie.title}_${new Date(movie.release_date).getFullYear() || 2026}`,
          originCountry: movie.original_language?.toUpperCase() || 'US'
        });
      }
    } catch (e: any) {
      console.warn('[Calendar] TMDB query pipeline failed:', e.message);
    }
  }

  // 4. Assemble into continuous daily buckets from startDateStr to endDateStr
  const days: CalendarDayGroup[] = [];
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const shortDayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let iterDate = new Date(startDateObj);
  let totalDrops = 0;
  let todayDropsCount = 0;
  let availableCount = 0;

  while (iterDate <= endDateObj) {
    const dStr = iterDate.toISOString().split('T')[0];
    const isToday = dStr === todayStr;
    const isPast = dStr < todayStr;
    const isFuture = dStr > todayStr;
    const dayDrops = dropsByDate.get(dStr) || [];

    // Sort drops within each day: available with seeders first, then watchlist, then popularity
    dayDrops.sort((a, b) => {
      if (a.inWatchlist && !b.inWatchlist) return -1;
      if (!a.inWatchlist && b.inWatchlist) return 1;
      return (b.seeders || 0) - (a.seeders || 0);
    });

    totalDrops += dayDrops.length;
    if (isToday) todayDropsCount = dayDrops.length;
    availableCount += dayDrops.filter(d => d.status === 'available').length;

    const dayOfWeek = dayNames[iterDate.getUTCDay()];
    const shortDay = shortDayNames[iterDate.getUTCDay()];
    const formattedDate = `${monthNames[iterDate.getUTCMonth()]} ${iterDate.getUTCDate()}`;

    days.push({
      date: dStr,
      dayOfWeek,
      shortDay,
      formattedDate,
      isToday,
      isPast,
      isFuture,
      drops: dayDrops
    });

    iterDate.setDate(iterDate.getDate() + 1);
  }

  const result = {
    today: todayStr,
    startDate: startDateStr,
    endDate: endDateStr,
    days,
    totalDrops,
    todayDropsCount,
    availableCount
  };

  // Cache results
  calendarCache.set(cacheKey, { timestamp: Date.now(), data: result });

  return result;
}
