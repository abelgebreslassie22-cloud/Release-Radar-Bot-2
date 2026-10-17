import axios from 'axios';
import { db } from '../database/db';
import { discoveredReleases, watchlist } from '../database/schema';
import { getSettings } from './settings';
import { DownloadRadarProvider } from '../providers/downloadRadarProvider';
import { classifyMedia, normalizeCategoryName } from '../utils/categoryHelper';
import { logInfo, logSuccess, logWarning, logError } from './logger';
import { eq, desc, inArray } from 'drizzle-orm';
import { syncWatchlistItemImmediately } from './scanner';
import { filterIgnoredDownloads } from './ignoredDownloads';

export interface QueuedDropCandidate {
  tmdbId: number;
  title: string;
  year: number;
  type: 'Movie' | 'Series';
  rawType?: string;
  category?: string;
  genreIds?: number[];
  originCountry: string;
  originalLanguage: string;
  poster: string | null;
  backdrop: string | null;
  overview: string;
  voteAverage: string;
  releaseDate: string;
  isAiringToday: boolean;
  searchQueries?: string[];
  queuedAt: string;
  attempts: number;
}

// In-memory persistent queue for drops waiting for scene torrent uploads
const pendingDropsQueue = new Map<string, QueuedDropCandidate>();

/**
 * Scan TMDB strictly for:
 * 1. Fresh movies released today / now playing (within past 30 days, no old movies)
 * 2. Active TV series with fresh episodes AIRING TODAY (e.g. Slow Horses, NCIS, Chicago Fire)
 * 3. Active Anime with episodes AIRING TODAY or past 3 days (no ended series)
 * 4. Active Western Animation with episodes AIRING TODAY or past 3 days (strictly no ended series like Regular Show)
 *
 * It queues these titles, searches torrent indexers every scan interval (e.g. 10m),
 * and creates cards with magnet links as soon as they drop!
 */
export async function scanForNewReleases(): Promise<{ 
  discoveredCount: number; 
  moviesCount: number; 
  showsCount: number; 
  animeCount: number;
  queuedCount: number;
}> {
  try {
    const settings = await getSettings();
    const apiKey = settings?.metadataApiKey || process.env.TMDB_API_KEY;

    if (!apiKey) {
      console.warn('[Discover] TMDB API key not configured. Cannot scan for new drops.');
      await logWarning('TMDB API Key missing. Please configure it in Settings to scan for new drops.', 'Discover');
      return { discoveredCount: 0, moviesCount: 0, showsCount: 0, animeCount: 0, queuedCount: 0 };
    }

    const downloadRadar = new DownloadRadarProvider();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const threeDaysAgoStr = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const thirtyDaysAgoStr = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    await logInfo(`[Discover Queue] Querying TMDB for fresh drops & today's (${todayStr}) airing episodes...`, 'Discover');

    const enqueueItem = (item: QueuedDropCandidate) => {
      const key = `${item.tmdbId}_${item.type}`;
      if (!pendingDropsQueue.has(key)) {
        pendingDropsQueue.set(key, item);
      }
    };

    // 1. Fresh Theatrical & Digital Movies released recently/today (Strictly within past 30 days)
    try {
      const nowPlayingRes = await axios.get('https://api.themoviedb.org/3/movie/now_playing', {
        params: { api_key: apiKey, page: 1 },
        timeout: 6000,
      });

      const rawNowPlaying = nowPlayingRes.data?.results || [];
      for (const m of rawNowPlaying.slice(0, 10)) {
        if (!m.title) continue;
        const relDate = m.release_date || todayStr;
        // Skip movies older than 35 days
        if (relDate < thirtyDaysAgoStr) continue;

        const year = m.release_date ? new Date(m.release_date).getFullYear() : now.getFullYear();
        enqueueItem({
          tmdbId: m.id,
          title: m.title || m.original_title,
          year,
          type: 'Movie',
          rawType: 'Movie',
          category: 'Movie',
          genreIds: m.genre_ids || [],
          originCountry: Array.isArray(m.origin_country) && m.origin_country.length > 0 ? m.origin_country[0] : 'US',
          originalLanguage: m.original_language || 'en',
          poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
          backdrop: m.backdrop_path ? `https://image.tmdb.org/t/p/w780${m.backdrop_path}` : null,
          overview: m.overview || '',
          voteAverage: m.vote_average ? m.vote_average.toFixed(1) : 'N/A',
          releaseDate: relDate,
          isAiringToday: relDate === todayStr,
          queuedAt: new Date().toISOString(),
          attempts: 0,
        });
      }
    } catch (npErr: any) {
      console.warn('[Discover] Failed to fetch now_playing movies:', npErr.message);
    }

    // 2. Active TV Series with Episodes Airing TODAY (e.g. Slow Horses, Chicago Fire, NCIS, etc.)
    // TMDB discover/tv with air_date.gte=today and air_date.lte=today returns ONLY active shows airing TODAY!
    try {
      const todayTvRes = await axios.get('https://api.themoviedb.org/3/discover/tv', {
        params: {
          api_key: apiKey,
          'air_date.gte': todayStr,
          'air_date.lte': todayStr,
          sort_by: 'popularity.desc',
          page: 1,
        },
        timeout: 6000,
      });

      const rawAiringToday = todayTvRes.data?.results || [];
      for (const s of rawAiringToday.slice(0, 12)) {
        if (!s.name) continue;
        const year = s.first_air_date ? new Date(s.first_air_date).getFullYear() : now.getFullYear();
        const originCountries = Array.isArray(s.origin_country) ? s.origin_country : [];
        const isAnime = s.original_language === 'ja' || originCountries.includes('JP') || ((s.genre_ids || []).includes(16) && s.original_language === 'ja');
        const isAnim = (s.genre_ids || []).includes(16);

        enqueueItem({
          tmdbId: s.id,
          title: s.name || s.original_name,
          year,
          type: 'Series',
          rawType: isAnime ? 'Anime' : (isAnim ? 'Animation' : 'Series'),
          category: isAnime ? 'Anime' : (isAnim ? 'Animation' : 'Series'),
          genreIds: s.genre_ids || [],
          originCountry: isAnime ? 'JP' : (originCountries[0] || 'US'),
          originalLanguage: s.original_language || 'en',
          poster: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : null,
          backdrop: s.backdrop_path ? `https://image.tmdb.org/t/p/w780${s.backdrop_path}` : null,
          overview: s.overview || '',
          voteAverage: s.vote_average ? s.vote_average.toFixed(1) : 'N/A',
          releaseDate: todayStr, // New episode aired today!
          isAiringToday: true,
          queuedAt: new Date().toISOString(),
          attempts: 0,
        });
      }
    } catch (airErr: any) {
      console.warn('[Discover] Failed to fetch airing_today shows:', airErr.message);
    }

    // 3. Active Anime with episodes airing in past 3 days / today (Strictly NO ended shows)
    try {
      const animeTvRes = await axios.get('https://api.themoviedb.org/3/discover/tv', {
        params: {
          api_key: apiKey,
          with_genres: '16', // Animation
          with_original_language: 'ja', // Japanese Anime
          'air_date.gte': threeDaysAgoStr,
          'air_date.lte': todayStr,
          sort_by: 'popularity.desc',
          page: 1,
        },
        timeout: 6000,
      });

      const rawAnime = animeTvRes.data?.results || [];
      for (const a of rawAnime.slice(0, 10)) {
        if (!a.name) continue;
        const year = a.first_air_date ? new Date(a.first_air_date).getFullYear() : now.getFullYear();
        enqueueItem({
          tmdbId: a.id,
          title: a.name || a.original_name,
          year,
          type: 'Series',
          rawType: 'Anime',
          category: 'Anime',
          genreIds: a.genre_ids || [16],
          originCountry: 'JP',
          originalLanguage: 'ja',
          poster: a.poster_path ? `https://image.tmdb.org/t/p/w500${a.poster_path}` : null,
          backdrop: a.backdrop_path ? `https://image.tmdb.org/t/p/w780${a.backdrop_path}` : null,
          overview: a.overview || '',
          voteAverage: a.vote_average ? a.vote_average.toFixed(1) : 'N/A',
          releaseDate: todayStr,
          isAiringToday: true,
          queuedAt: new Date().toISOString(),
          attempts: 0,
        });
      }
    } catch (animeErr: any) {
      console.warn('[Discover] Failed to fetch active anime TV from TMDB:', animeErr.message);
    }

    // 4. Active Western Animation with episodes airing in past 3 days / today (Strictly NO ended shows like Regular Show)
    try {
      const animTvRes = await axios.get('https://api.themoviedb.org/3/discover/tv', {
        params: {
          api_key: apiKey,
          with_genres: '16', // Animation
          with_original_language: 'en',
          'air_date.gte': threeDaysAgoStr,
          'air_date.lte': todayStr,
          sort_by: 'popularity.desc',
          page: 1,
        },
        timeout: 6000,
      });

      const rawAnim = animTvRes.data?.results || [];
      for (const an of rawAnim.slice(0, 8)) {
        if (!an.name) continue;
        const year = an.first_air_date ? new Date(an.first_air_date).getFullYear() : now.getFullYear();
        enqueueItem({
          tmdbId: an.id,
          title: an.name || an.original_name,
          year,
          type: 'Series',
          rawType: 'Animation',
          category: 'Animation',
          genreIds: an.genre_ids || [16],
          originCountry: 'US',
          originalLanguage: 'en',
          poster: an.poster_path ? `https://image.tmdb.org/t/p/w500${an.poster_path}` : null,
          backdrop: an.backdrop_path ? `https://image.tmdb.org/t/p/w780${an.backdrop_path}` : null,
          overview: an.overview || '',
          voteAverage: an.vote_average ? an.vote_average.toFixed(1) : 'N/A',
          releaseDate: todayStr,
          isAiringToday: true,
          queuedAt: new Date().toISOString(),
          attempts: 0,
        });
      }
    } catch (animErr: any) {
      console.warn('[Discover] Failed to fetch active animation TV from TMDB:', animErr.message);
    }

    // Genre mapping for human-readable labels
    const genreMap: Record<number, string> = {
      28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
      99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
      27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction',
      10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
      10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality',
      10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics'
    };

    const itemsToProcess = Array.from(pendingDropsQueue.values());
    await logInfo(`[Discover Queue] ${itemsToProcess.length} title(s) in active monitoring queue. Searching torrent indexers...`, 'Discover');

    let savedCount = 0;
    let moviesSaved = 0;
    let showsSaved = 0;
    let animeSaved = 0;

    // Search torrent indexers with bounded concurrency (4 parallel workers)
    const concurrency = 4;
    for (let i = 0; i < itemsToProcess.length; i += concurrency) {
      const batch = itemsToProcess.slice(i, i + concurrency);
      
      await Promise.all(batch.map(async (item) => {
        try {
          item.attempts = (item.attempts || 0) + 1;
          const genreNames = (item.genreIds || []).map((id: number) => genreMap[id]).filter(Boolean).join(', ');
          
          const category = classifyMedia({
            title: item.title,
            type: item.type,
            category: item.category,
            metadataJson: {
              genres: genreNames,
              country: item.originCountry === 'JP' ? 'Japan' : 'United States',
              originCountry: item.originCountry || 'US',
              language: item.originalLanguage === 'ja' ? 'Japanese' : 'English',
              originalLanguage: item.originalLanguage,
            }
          });

          // Search scene & web release indexers for magnet links
          let downloads: any[] = [];
          try {
            const searchType = category === 'Anime' ? 'Anime' : item.type;
            const dlMatches = await downloadRadar.findDownloadsForTitle(item.title, item.year, searchType);
            downloads = dlMatches.map(d => {
              let sizeText = d.sizeText;
              if (!sizeText && d.sizeBytes) {
                sizeText = formatBytes(d.sizeBytes);
              }
              if (!sizeText) {
                sizeText = extractSizeFromTitle(d.name);
              }
              return {
                title: d.name,
                quality: d.quality,
                sizeText: sizeText || '',
                sizeBytes: d.sizeBytes,
                seeders: d.seeders,
                leechers: d.leechers,
                magnetUrl: d.magnetUrl,
                sourceUrl: d.sourceUrl,
                uploadedAt: d.uploadedAt ? d.uploadedAt.toISOString() : undefined
              };
            });
          } catch (dlErr) {
            // Non-fatal if indexers are slow
          }

          downloads = await filterIgnoredDownloads(downloads);

          // If no torrents available yet:
          // Keep item in queue for next 10-minute scan interval!
          if (!downloads || downloads.length === 0) {
            console.log(`[Discover Queue] "${item.title}" (${item.releaseDate}) waiting for torrent releases...`);
            return;
          }

          const topSeeds = downloads.reduce((max, d) => Math.max(max, d.seeders || 0), 0);

          // Once released on torrent: Save / Upsert card with verified magnet links!
          await db.insert(discoveredReleases).values({
            tmdbId: item.tmdbId,
            title: item.title,
            year: item.year,
            type: item.type,
            category,
            originCountry: item.originCountry || 'US',
            poster: item.poster,
            backdrop: item.backdrop,
            overview: item.overview,
            voteAverage: item.voteAverage,
            releaseDate: item.releaseDate,
            genres: genreNames,
            downloads,
            topSeeds,
            updatedAt: new Date()
          }).onConflictDoUpdate({
            target: [discoveredReleases.tmdbId, discoveredReleases.type],
            set: {
              title: item.title,
              category,
              originCountry: item.originCountry || 'US',
              poster: item.poster,
              backdrop: item.backdrop,
              overview: item.overview,
              voteAverage: item.voteAverage,
              releaseDate: item.releaseDate,
              genres: genreNames,
              downloads,
              topSeeds,
              updatedAt: new Date()
            }
          });

          savedCount++;
          if (category === 'Anime') animeSaved++;
          else if (category === 'Movie') moviesSaved++;
          else showsSaved++;

          console.log(`[Discover] Successfully created/updated card for "${item.title}" with ${downloads.length} magnet links!`);
        } catch (insertErr: any) {
          console.warn(`[Discover] Error processing queued title "${item.title}":`, insertErr.message);
        }
      }));
    }

    // Auto purge any ended old shows from DB
    await purgeOldShowsFromDiscovered().catch(() => {});

    await logSuccess(`Discover cycle complete: ${savedCount} card(s) ready with magnet links (${moviesSaved} movies, ${showsSaved} series, ${animeSaved} anime). ${pendingDropsQueue.size} tracked in queue.`, 'Discover');
    return { 
      discoveredCount: savedCount, 
      moviesCount: moviesSaved, 
      showsCount: showsSaved, 
      animeCount: animeSaved,
      queuedCount: pendingDropsQueue.size
    };
  } catch (error: any) {
    console.error('[Discover] Scan error:', error);
    await logError(`Discover scan error: ${error.message}`, 'Discover');
    return { discoveredCount: 0, moviesCount: 0, showsCount: 0, animeCount: 0, queuedCount: pendingDropsQueue.size };
  }
}

/**
 * Remove old shows or ended shows from discovered releases
 */
export async function purgeOldShowsFromDiscovered(): Promise<number> {
  try {
    const all = await db.select().from(discoveredReleases);
    const knownEndedShows = [
      'regular show', 'raw', 'law & order', 'law & order: special victims unit', 
      'late night with seth meyers', 'the tonight show starring jimmy fallon', 
      'the daily show', 'the secret lives of mormon wives', 'ted lasso', 
      'teen titans go!', 'american dad!', 'family guy', 'avatar: seven havens'
    ];

    const toDeleteIds: number[] = [];
    for (const item of all) {
      const lowerTitle = item.title.toLowerCase();
      if (knownEndedShows.some(ended => lowerTitle === ended || lowerTitle.startsWith(ended))) {
        toDeleteIds.push(item.id);
      }
    }

    if (toDeleteIds.length > 0) {
      await db.delete(discoveredReleases).where(inArray(discoveredReleases.id, toDeleteIds));
      console.log(`[Discover] Purged ${toDeleteIds.length} ended/old show cards from database.`);
    }
    return toDeleteIds.length;
  } catch (err: any) {
    console.warn('[Discover] Purge old shows error:', err.message);
    return 0;
  }
}

/**
 * Delete a specific discovered release card by ID
 */
export async function deleteDiscoveredRelease(id: number): Promise<boolean> {
  try {
    const res = await db.delete(discoveredReleases).where(eq(discoveredReleases.id, id)).returning();
    return res.length > 0;
  } catch (err) {
    console.error(`[Discover] Error deleting discovered release ${id}:`, err);
    return false;
  }
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

export function extractSizeFromTitle(title?: string): string {
  if (!title) return '';
  const match = title.match(/[\(\[\s](\d+(?:\.\d+)?\s*(?:GB|MB|GiB|MiB|TB))[\)\]\s]/i) 
    || title.match(/(\d+(?:\.\d+)?\s*(?:GB|MB|GiB|MiB|TB))\b/i);
  return match ? match[1].trim() : '';
}

/**
 * Retrieve discovered releases with watchlist status and optional category filters.
 * Strictly returns releases with verified magnet download links.
 */
export async function getDiscoveredReleases(options?: { category?: string; search?: string }) {
  try {
    let allDiscovered = await db.select().from(discoveredReleases).orderBy(desc(discoveredReleases.releaseDate), desc(discoveredReleases.id));

    // Filter strictly to releases with verified download magnets
    allDiscovered = allDiscovered.filter(d => Array.isArray(d.downloads) && (d.downloads as any[]).length > 0);

    // Get current watchlist titles for quick 1-click status checking
    const currentWatchlist = await db.select({ title: watchlist.title, year: watchlist.year }).from(watchlist);
    const watchlistKeySet = new Set(
      currentWatchlist.map(w => `${w.title.toLowerCase().replace(/[^a-z0-9]/g, '')}_${w.year}`)
    );
    const watchlistTitleSet = new Set(
      currentWatchlist.map(w => w.title.toLowerCase().replace(/[^a-z0-9]/g, ''))
    );

    // Apply category filter if requested (with robust singular/plural normalization)
    if (options?.category && options.category !== 'All') {
      const targetCat = normalizeCategoryName(options.category);
      allDiscovered = allDiscovered.filter(d => {
        const itemCat = normalizeCategoryName(d.category);
        const dynamicCat = normalizeCategoryName(classifyMedia({
          title: d.title,
          type: d.type,
          category: d.category,
          metadataJson: {
            genres: d.genres,
            country: d.originCountry === 'JP' ? 'Japan' : 'United States',
            originCountry: d.originCountry,
          }
        }));
        return itemCat === targetCat || dynamicCat === targetCat;
      });
    }

    // Apply search filter if requested
    if (options?.search && options.search.trim()) {
      const q = options.search.toLowerCase().trim();
      allDiscovered = allDiscovered.filter(d => d.title.toLowerCase().includes(q) || (d.genres || '').toLowerCase().includes(q));
    }

    return allDiscovered.map(d => {
      const normTitle = d.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      const key = `${normTitle}_${d.year}`;
      const inWatchlist = watchlistKeySet.has(key) || watchlistTitleSet.has(normTitle);

      const computedCategory = classifyMedia({
        title: d.title,
        type: d.type,
        category: d.category,
        metadataJson: {
          genres: d.genres,
          country: d.originCountry === 'JP' ? 'Japan' : 'United States',
          originCountry: d.originCountry,
        }
      });

      const rawDownloads = Array.isArray(d.downloads) ? (d.downloads as any[]) : [];
      const downloads = rawDownloads.map(dl => {
        let sizeText = dl.sizeText;
        if (!sizeText && dl.sizeBytes) {
          sizeText = formatBytes(dl.sizeBytes);
        }
        if (!sizeText) {
          sizeText = extractSizeFromTitle(dl.title || dl.name);
        }
        return {
          ...dl,
          sizeText: sizeText || ''
        };
      });

      return {
        ...d,
        category: computedCategory,
        downloads,
        inWatchlist,
        downloadsCount: downloads.length
      };
    });
  } catch (error: any) {
    console.error('[Discover] Error fetching discovered releases:', error);
    return [];
  }
}

/**
 * Get a single discovered release by ID for detailed viewing.
 */
export async function getDiscoveredReleaseById(id: number) {
  try {
    const items = await db.select().from(discoveredReleases).where(eq(discoveredReleases.id, id)).limit(1);
    if (items.length === 0) return null;
    const d = items[0];

    const currentWatchlist = await db.select({ id: watchlist.id, title: watchlist.title, year: watchlist.year }).from(watchlist);
    const normDTitle = d.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    const inWatchlist = currentWatchlist.some(w => {
      const normW = w.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      return normW === normDTitle;
    });

    const rawDownloads = Array.isArray(d.downloads) ? (d.downloads as any[]) : [];
    const downloads = rawDownloads.map(dl => {
      let sizeText = dl.sizeText;
      if (!sizeText && dl.sizeBytes) {
        sizeText = formatBytes(dl.sizeBytes);
      }
      if (!sizeText) {
        sizeText = extractSizeFromTitle(dl.title || dl.name);
      }
      return {
        ...dl,
        sizeText: sizeText || ''
      };
    });

    return {
      ...d,
      downloads,
      inWatchlist,
      downloadsCount: downloads.length
    };
  } catch (e) {
    return null;
  }
}

/**
 * 1-Click Toggle: Adds or removes a discovered title from the monitored Watchlist.
 */
export async function toggleDiscoveredWatchlist(discoveredId: number): Promise<{
  success: boolean;
  inWatchlist: boolean;
  action: 'added' | 'removed';
  error?: string;
  item?: any;
}> {
  try {
    const found = await db.select().from(discoveredReleases).where(eq(discoveredReleases.id, discoveredId)).limit(1);
    if (found.length === 0) {
      return { success: false, inWatchlist: false, action: 'removed', error: 'Discovered title not found' };
    }

    const d = found[0];

    // Check if title is already in watchlist (exact or normalized match)
    const allWatchlist = await db.select().from(watchlist);
    const normDTitle = d.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    const existing = allWatchlist.find(w => {
      const normW = w.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      return w.title.toLowerCase() === d.title.toLowerCase() || normW === normDTitle;
    });

    if (existing) {
      // It exists -> REMOVE it from watchlist
      await db.delete(watchlist).where(eq(watchlist.id, existing.id));
      await logInfo(`Removed discovered title "${d.title} (${d.year})" from Watchlist`, 'Watchlist');

      return {
        success: true,
        inWatchlist: false,
        action: 'removed',
        item: { title: d.title, year: d.year }
      };
    } else {
      // It does not exist -> ADD it to watchlist
      const [inserted] = await db.insert(watchlist).values({
        title: d.title,
        year: d.year,
        type: d.category || d.type
      }).onConflictDoNothing().returning();

      syncWatchlistItemImmediately({
        title: d.title,
        year: d.year,
        type: d.category || d.type
      }).catch(() => {});

      await logSuccess(`Added discovered title "${d.title} (${d.year})" to monitored Watchlist`, 'Watchlist');

      return {
        success: true,
        inWatchlist: true,
        action: 'added',
        item: inserted || { title: d.title, year: d.year, type: d.category }
      };
    }
  } catch (error: any) {
    return { success: false, inWatchlist: false, action: 'removed', error: error.message };
  }
}

/**
 * 1-Click: Promotes a discovered title to the active monitored Watchlist (toggle supported).
 */
export async function addDiscoveredToWatchlist(discoveredId: number) {
  return await toggleDiscoveredWatchlist(discoveredId);
}
