import { db } from '../database/db';
import { watchlist, releases, settings } from '../database/schema';
import { fetchMetadata } from '../metadata/tmdb';
import { sendTelegramNotification } from '../telegram/bot';
import { eq } from 'drizzle-orm';
import { logInfo, logError, logWarning, logSuccess, logDebug } from './logger';
import { Provider } from '../types';
import { getStandardizedMatchKey, normalizeMediaTitle } from '../utils/mediaGrouper';
import { generateCustomPoster } from '../utils/posterGenerator';
import { DownloadRadarProvider } from '../providers/downloadRadarProvider';
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

    // Process each watchlist item individually to ensure exactly ONE consolidated card per title
    for (const wl of items) {
      const normWlTitle = normalizeMediaTitle(wl.title).toLowerCase().replace(/[^a-z0-9]/g, '');
      const isTV = wl.type?.toLowerCase() === 'series' || wl.type?.toLowerCase() === 'anime';

      // Check if a download is available for this title
      const dlItem = downloadItems.find(d => {
        const normDTitle = normalizeMediaTitle(d.title).toLowerCase().replace(/[^a-z0-9]/g, '');
        return normDTitle === normWlTitle || normDTitle.includes(normWlTitle) || normWlTitle.includes(normDTitle);
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
          sourceUrl: dlItem?.sourceUrl || tmdbItem?.sourceUrl || '',
        };
      }
      if (!posterUrl) {
        posterUrl = generateCustomPoster({
          title: wl.title,
          year: wl.year,
          type: wl.type,
          releaseType: dlItem?.releaseType || tmdbItem?.releaseType || 'Monitored',
          sourceUrl: dlItem?.sourceUrl || tmdbItem?.sourceUrl || '',
          provider: dlItem ? 'Download Radar' : 'TMDB Radar',
        });
        metadata.poster = posterUrl;
      }

      // Determine final status, sourceUrl, provider, and seeders
      let finalStatus: string;
      let finalSourceUrl: string;
      let finalProvider: string;
      let finalSeeders = 0;
      let finalLeechers = 0;

      if (dlItem) {
        finalStatus = dlItem.releaseType;
        finalSourceUrl = dlItem.sourceUrl;
        finalProvider = 'Download Availability Radar';
        finalSeeders = dlItem.seeders || 0;
        finalLeechers = dlItem.leechers || 0;
      } else if (tmdbItem) {
        finalStatus = tmdbItem.releaseType;
        finalSourceUrl = tmdbItem.sourceUrl;
        finalProvider = 'TMDB Premiere Radar';
      } else {
        finalStatus = `⏳ Monitoring release schedule`;
        finalSourceUrl = metadata?.sourceUrl || `https://www.themoviedb.org/search?query=${encodeURIComponent(wl.title)}`;
        finalProvider = 'Release Radar';
      }

      // Find existing card in database
      const existingCard = existingReleases.find(r => {
        const normRTitle = normalizeMediaTitle(r.title).toLowerCase().replace(/[^a-z0-9]/g, '');
        const isRTV = r.type?.toLowerCase() === 'series' || r.type?.toLowerCase() === 'anime';
        const sameType = isTV === isRTV;
        const titleMatch = normWlTitle === normRTitle || normWlTitle.startsWith(normRTitle) || normRTitle.startsWith(normWlTitle);
        return titleMatch && sameType;
      });

      if (existingCard) {
        // Did status transition to Download Available, or did episode/link change?
        const isNowDownload = finalStatus.includes('Download Available');
        const wasDownload = existingCard.releaseType.includes('Download Available');
        const statusChanged = existingCard.releaseType !== finalStatus || existingCard.sourceUrl !== finalSourceUrl;
        const becameDownloadable = isNowDownload && !wasDownload;

        await db.update(releases).set({
          title: wl.title,
          year: wl.year,
          type: wl.type,
          provider: finalProvider,
          sourceUrl: finalSourceUrl,
          releaseType: finalStatus,
          poster: posterUrl,
          metadataJson: metadata,
          seeders: finalSeeders,
          leechers: finalLeechers,
        }).where(eq(releases.id, existingCard.id));

        // Update in-memory reference
        existingCard.releaseType = finalStatus;
        existingCard.sourceUrl = finalSourceUrl;
        existingCard.poster = posterUrl;
        existingCard.metadataJson = metadata;

        if (becameDownloadable || (statusChanged && isNowDownload)) {
          await logSuccess(`🔥 Download alert ready: ${wl.title} [${finalStatus}]`, 'DownloadRadar');
          notificationsToSend.push({
            id: existingCard.id,
            title: wl.title,
            year: wl.year,
            type: wl.type,
            provider: finalProvider,
            sourceUrl: finalSourceUrl,
            releaseType: finalStatus,
            poster: posterUrl,
            metadataJson: metadata,
          });
        } else if (statusChanged) {
          await logInfo(`Updated release card: ${wl.title} [${finalStatus}]`, 'Scanner');
        }
      } else {
        // Insert new card for this title
        const [inserted] = await db.insert(releases).values({
          title: wl.title,
          year: wl.year,
          type: wl.type,
          provider: finalProvider,
          sourceUrl: finalSourceUrl,
          releaseType: finalStatus,
          seeders: finalSeeders,
          leechers: finalLeechers,
          poster: posterUrl,
          metadataJson: metadata,
        }).returning();

        if (inserted) {
          existingReleases.push(inserted);
          await logSuccess(`Created release card: ${wl.title} [${finalStatus}]`, 'Matcher');
          notificationsToSend.push(inserted);
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
