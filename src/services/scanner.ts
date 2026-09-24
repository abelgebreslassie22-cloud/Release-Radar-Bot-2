import { db } from '../database/db';
import { watchlist, releases, settings } from '../database/schema';
import { fetchMetadata } from '../metadata/tmdb';
import { sendTelegramNotification } from '../telegram/bot';
import { eq } from 'drizzle-orm';
import { logInfo, logError, logWarning, logSuccess, logDebug } from './logger';
import { Provider } from '../types';
import { getStandardizedMatchKey, normalizeMediaTitle } from '../utils/mediaGrouper';
import { generateCustomPoster } from '../utils/posterGenerator';
import { DownloadRadarProvider, extractEpisodeOrPack } from '../providers/downloadRadarProvider';
import { TMDBPremiereProvider } from '../providers/tmdbProvider';

let isScanning = false;

export function isWatchlistMatch(
  release: { title: string; year: number; type: string },
  watchlistItems: { title: string; year: number; type: string }[]
): boolean {
  if (!watchlistItems || watchlistItems.length === 0) return false;

  return watchlistItems.some((w) => {
    const isSeries = w.type?.toLowerCase() === 'series' || release.type?.toLowerCase() === 'series';

    // Base titles without quality/tags/seasons
    const normWBase = normalizeMediaTitle(w.title).toLowerCase().replace(/[^a-z0-9]/g, '');
    const normIBase = normalizeMediaTitle(release.title).toLowerCase().replace(/[^a-z0-9]/g, '');

    const normWKey = getStandardizedMatchKey(w.title);
    const normIKey = getStandardizedMatchKey(release.title);

    let titleMatches = false;

    if (normWBase && normIBase) {
      if (normWBase === normIBase || normIBase.startsWith(normWBase) || normWBase.startsWith(normIBase)) {
        titleMatches = true;
      }
    }
    if (!titleMatches) {
      if (normWKey === normIKey || normIKey.includes(normWKey) || normWKey.includes(normIKey)) {
        titleMatches = true;
      }
    }

    if (!titleMatches) return false;

    // Year matching: TV series span multiple years across seasons; ignore strict year check for series
    const yearMatches = isSeries || Math.abs(w.year - release.year) <= 2;

    return yearMatches;
  });
}

export async function runScan() {
  if (isScanning) {
    console.log('Scan already in progress. Skipping...');
    return;
  }
  isScanning = true;
  console.log('Starting provider scan...');
  await logInfo('Scanner started', 'Scanner');
  
  try {
    const currentSettings = await db.select().from(settings).limit(1);
    if (currentSettings.length > 0) {
      await db.update(settings).set({ lastScan: new Date() }).where(eq(settings.id, currentSettings[0].id));
    }
    
    const activeSettings: any = currentSettings[0] || {};
    
    const items = await db.select().from(watchlist);
    if (items.length === 0) {
      console.log('Watchlist is empty. Scanner only monitors your watchlist.');
      await logInfo('Watchlist is empty. Add titles via /add or the web app to monitor releases.', 'Scanner');
      return;
    }

    await logInfo(`Searching ${items.length} watchlist item(s) across download indexers & premiere radar...`, 'Scanner');

    // 1. Always initialize DownloadRadarProvider (Scene & Web Release Indexer)
    const downloadRadar = new DownloadRadarProvider();
    const tmdbRadar = new TMDBPremiereProvider();

    // Scan for downloads
    let downloadItems: any[] = [];
    try {
      await logInfo('Checking scene release indexers for available downloads...', 'DownloadRadar');
      downloadItems = await downloadRadar.scan(items);
      await logSuccess(`Found ${downloadItems.length} active download release(s)`, 'DownloadRadar');
    } catch (e: any) {
      await logWarning(`Download radar scan failed: ${e.message}`, 'DownloadRadar');
    }

    // Scan TMDB for streaming/air-dates/metadata
    let tmdbItems: any[] = [];
    try {
      tmdbItems = await tmdbRadar.scan(items);
    } catch (e: any) {
      await logWarning(`TMDB radar scan failed: ${e.message}`, 'TMDBRadar');
    }

    // Fetch existing release cards from database
    const existingReleases = await db.select().from(releases);
    const notificationsToSend: any[] = [];

    // Process each watchlist item to discover and store all available qualities and episodes
    for (const wl of items) {
      const normWlTitle = normalizeMediaTitle(wl.title).toLowerCase().replace(/[^a-z0-9]/g, '');
      const isTV = wl.type?.toLowerCase() === 'series' || wl.type?.toLowerCase() === 'anime';

      // Find all download releases for this title across qualities and episodes
      const matchingDlItems = downloadItems.filter(d => {
        const normDTitle = normalizeMediaTitle(d.title).toLowerCase().replace(/[^a-z0-9]/g, '');
        return normDTitle === normWlTitle || normDTitle.startsWith(normWlTitle) || normWlTitle.startsWith(normDTitle);
      });

      // Check TMDB premiere / streaming status
      const tmdbItem = tmdbItems.find(t => {
        const normTTitle = normalizeMediaTitle(t.title).toLowerCase().replace(/[^a-z0-9]/g, '');
        return normTTitle === normWlTitle || normTTitle.includes(normWlTitle) || normWlTitle.includes(normTTitle);
      });

      // Fetch official poster and metadata
      const baseTitle = normalizeMediaTitle(wl.title);
      let metadata: any = await fetchMetadata(baseTitle, wl.year, wl.type);
      let posterUrl = metadata?.poster || null;

      if (!metadata) {
        metadata = {
          poster: posterUrl,
          overview: `Monitored watchlist item: ${wl.title} (${wl.year})`,
          sourceUrl: matchingDlItems[0]?.sourceUrl || tmdbItem?.sourceUrl || '',
        };
      }
      if (!posterUrl) {
        posterUrl = generateCustomPoster({
          title: wl.title,
          year: wl.year,
          type: wl.type,
          releaseType: matchingDlItems[0]?.releaseType || tmdbItem?.releaseType || 'Monitored',
          sourceUrl: matchingDlItems[0]?.sourceUrl || tmdbItem?.sourceUrl || '',
          provider: matchingDlItems.length > 0 ? 'Download Radar' : 'TMDB Radar',
        });
        metadata.poster = posterUrl;
      }

      if (matchingDlItems.length > 0) {
        // Track which episodes or releases were ALREADY in the database before this scan
        const knownEpisodes = new Set<string>();
        let movieAlreadySaved = false;

        for (const r of existingReleases) {
          const normRTitle = normalizeMediaTitle(r.title).toLowerCase().replace(/[^a-z0-9]/g, '');
          const isMatch = normWlTitle === normRTitle || normWlTitle.startsWith(normRTitle) || normRTitle.startsWith(normWlTitle);
          if (isMatch && (r.sourceUrl?.startsWith('magnet:') || r.releaseType?.includes('Download Available'))) {
            if (isTV) {
              const ep = extractEpisodeOrPack(r.title) || extractEpisodeOrPack(r.releaseType);
              if (ep) {
                knownEpisodes.add(ep.toUpperCase());
              }
            } else {
              movieAlreadySaved = true;
            }
          }
        }

        // Remove any old non-download placeholder cards for this title
        const placeholderCards = existingReleases.filter(r => {
          const normRTitle = normalizeMediaTitle(r.title).toLowerCase().replace(/[^a-z0-9]/g, '');
          const isMatch = normWlTitle === normRTitle || normWlTitle.startsWith(normRTitle) || normRTitle.startsWith(normWlTitle);
          return isMatch && !r.sourceUrl?.startsWith('magnet:') && !r.releaseType?.includes('Download Available');
        });

        for (const ph of placeholderCards) {
          await db.delete(releases).where(eq(releases.id, ph.id));
          const idx = existingReleases.findIndex(r => r.id === ph.id);
          if (idx !== -1) existingReleases.splice(idx, 1);
        }

        const newEpisodeNotifications: any[] = [];
        let newlyDiscoveredCount = 0;

        for (const dl of matchingDlItems) {
          // Check if this specific release already exists in database
          const existingRelease = existingReleases.find(r => r.sourceUrl === dl.sourceUrl || r.title === dl.title);

          if (existingRelease) {
            // Update stats
            await db.update(releases).set({
              releaseType: dl.releaseType,
              seeders: dl.seeders || 0,
              leechers: dl.leechers || 0,
              poster: posterUrl,
              metadataJson: metadata,
            }).where(eq(releases.id, existingRelease.id));

            existingRelease.releaseType = dl.releaseType;
            existingRelease.seeders = dl.seeders;
            existingRelease.leechers = dl.leechers;
          } else {
            // Insert newly discovered quality / release into DB so admin can view all qualities on web app
            const [inserted] = await db.insert(releases).values({
              title: dl.title,
              year: wl.year,
              type: wl.type,
              provider: 'Download Availability Radar',
              sourceUrl: dl.sourceUrl,
              releaseType: dl.releaseType,
              seeders: dl.seeders || 0,
              leechers: dl.leechers || 0,
              poster: posterUrl,
              metadataJson: metadata,
            }).returning();

            if (inserted) {
              existingReleases.push(inserted);
              newlyDiscoveredCount++;

              // STRICT ONE-TIME NOTIFICATION CHECK:
              // 1. For TV shows: only notify when a brand-new episode drops. Skip if this episode was already saved before!
              // 2. For movies: only notify once when the movie first becomes downloadable. Skip when other qualities are added!
              if (isTV) {
                const ep = extractEpisodeOrPack(dl.title) || extractEpisodeOrPack(dl.releaseType);
                const epKey = (ep || 'GENERAL').toUpperCase();
                if (!knownEpisodes.has(epKey)) {
                  // Brand new episode discovered!
                  knownEpisodes.add(epKey);
                  newEpisodeNotifications.push(inserted);
                  await logSuccess(`🔥 Brand new episode dropped: ${wl.title} ${epKey}`, 'DownloadRadar');
                }
              } else {
                if (!movieAlreadySaved) {
                  movieAlreadySaved = true;
                  newEpisodeNotifications.push(inserted);
                  await logSuccess(`🔥 Movie newly available: ${wl.title}`, 'DownloadRadar');
                }
              }
            }
          }
        }

        if (newlyDiscoveredCount > 0) {
          await logInfo(`Saved ${newlyDiscoveredCount} new quality release(s) for "${wl.title}" to database`, 'DownloadRadar');
        }

        // Queue notifications for newly discovered episodes only
        if (newEpisodeNotifications.length > 0) {
          for (const itemToNotify of newEpisodeNotifications) {
            notificationsToSend.push(itemToNotify);
          }
        }
      } else {
        // No downloads available yet: keep a single status / scheduled release card
        const finalStatus = tmdbItem ? tmdbItem.releaseType : `⏳ Monitoring release schedule`;
        const finalSourceUrl = tmdbItem ? tmdbItem.sourceUrl : (metadata?.sourceUrl || `https://www.themoviedb.org/search?query=${encodeURIComponent(wl.title)}`);
        const finalProvider = tmdbItem ? 'TMDB Premiere Radar' : 'Release Radar';

        const existingCard = existingReleases.find(r => {
          const normRTitle = normalizeMediaTitle(r.title).toLowerCase().replace(/[^a-z0-9]/g, '');
          return normWlTitle === normRTitle || normWlTitle.startsWith(normRTitle) || normRTitle.startsWith(normWlTitle);
        });

        if (existingCard) {
          const statusChanged = existingCard.releaseType !== finalStatus;
          await db.update(releases).set({
            title: wl.title,
            year: wl.year,
            type: wl.type,
            provider: finalProvider,
            sourceUrl: finalSourceUrl,
            releaseType: finalStatus,
            poster: posterUrl,
            metadataJson: metadata,
          }).where(eq(releases.id, existingCard.id));

          existingCard.releaseType = finalStatus;
          existingCard.sourceUrl = finalSourceUrl;
          if (statusChanged && tmdbItem) {
            notificationsToSend.push(existingCard);
          }
        } else {
          const [inserted] = await db.insert(releases).values({
            title: wl.title,
            year: wl.year,
            type: wl.type,
            provider: finalProvider,
            sourceUrl: finalSourceUrl,
            releaseType: finalStatus,
            poster: posterUrl,
            metadataJson: metadata,
          }).returning();

          if (inserted) {
            existingReleases.push(inserted);
            if (tmdbItem) {
              notificationsToSend.push(inserted);
            }
          }
        }
      }
    }

    // Send Telegram notifications for new or upgraded cards
    for (const item of notificationsToSend) {
      try {
        await sendTelegramNotification(item);
      } catch (err: any) {
        console.error('Failed to dispatch notification:', err);
      }
    }

    await logSuccess(`Scan complete. ${notificationsToSend.length} alert(s) dispatched.`, 'Scanner');
  } catch (error: any) {
    console.error('Error in scanner execution:', error);
    await logError(`Scanner execution error: ${error.message}`, 'Scanner');
  } finally {
    isScanning = false;
  }
}
