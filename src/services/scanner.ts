import { db } from '../database/db';
import { watchlist, releases, settings } from '../database/schema';
import { fetchMetadata } from '../metadata/tmdb';
import { sendTelegramNotification } from '../telegram/bot';
import { and, eq } from 'drizzle-orm';
import { logInfo, logError, logWarning, logSuccess, logDebug } from './logger';
import { Provider } from '../types';
import { getStandardizedMatchKey, normalizeMediaTitle } from '../utils/mediaGrouper';
import { generateCustomPoster } from '../utils/posterGenerator';

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
    let providers: Provider[] = [];
    
    if (activeSettings.providerType === 'MOCK') {
      const { MockRSSProvider } = await import('../providers/mockRssProvider');
      providers.push(new MockRSSProvider());
    } else if (activeSettings.providerType === 'RSS' && activeSettings.providerUrl) {
      const { RSSProvider } = await import('../providers/rssProvider');
      providers.push(new RSSProvider(activeSettings.providerUrl));
    } else if (activeSettings.providerType === 'TMDB') {
      const { TMDBPremiereProvider } = await import('../providers/tmdbProvider');
      providers.push(new TMDBPremiereProvider());
    } else if (activeSettings.providerType === 'NONE') {
      await logInfo('Provider is disabled (NONE). Skipping scan.', 'Scanner');
      return;
    } else if (activeSettings.providerUrl) {
      const { RSSProvider } = await import('../providers/rssProvider');
      providers.push(new RSSProvider(activeSettings.providerUrl));
    } else {
      // Default: TMDB Digital & TV Premiere Polling
      const { TMDBPremiereProvider } = await import('../providers/tmdbProvider');
      providers.push(new TMDBPremiereProvider());
    }

    const items = await db.select().from(watchlist);
    if (items.length === 0) {
      console.log('Watchlist is empty. Scanner is configured to only search your watchlist.');
      await logInfo('Watchlist is empty. Skipping scan as scanner only searches items on your watchlist.', 'Scanner');
      return;
    }

    for (const provider of providers) {
      try {
        let matchingCount = 0;
        let notificationsCount = 0;
        
        await logInfo(`Provider started: ${provider.name}`, 'Scanner');
        await logInfo(`Searching ${items.length} watchlist item(s)...`, 'Scanner');
        
        const foundItems = await provider.scan(items);
        
        await logSuccess(`Items received: ${foundItems.length}`, 'Scanner');

        // Fetch existing release cards from database
        const existingReleases = await db.select().from(releases);

        const matchedNotifications: any[] = [];

        for (const item of foundItems) {
          // Strictly verify the item matches the watchlist
          const isMatched = isWatchlistMatch(item, items);
          if (!isMatched) {
            continue;
          }

          // Fetch or prepare poster and metadata
          let posterUrl = item.poster || null;
          let metadata: any = null;
          if (!posterUrl) {
            const baseTitle = normalizeMediaTitle(item.title);
            metadata = await fetchMetadata(baseTitle, item.year, item.type);
            posterUrl = metadata?.poster || null;
          }
          if (!metadata) {
            metadata = {
              poster: posterUrl,
              overview: item.overview || `Monitored from ${provider.name}. ${item.title}`,
              sourceUrl: item.sourceUrl,
            };
          }
          if (!posterUrl) {
            posterUrl = generateCustomPoster({
              title: item.title,
              year: item.year,
              type: item.type,
              releaseType: item.releaseType,
              sourceUrl: item.sourceUrl,
              provider: provider.name,
            });
            metadata.poster = posterUrl;
          }

          // Single Card per Movie or Series:
          // Check if an existing card already exists for this title & media type
          const normItemTitle = normalizeMediaTitle(item.title).toLowerCase().replace(/[^a-z0-9]/g, '');
          const isItemTV = item.type?.toLowerCase() === 'series' || item.type?.toLowerCase() === 'anime';

          const existingCard = existingReleases.find(r => {
            const normRTitle = normalizeMediaTitle(r.title).toLowerCase().replace(/[^a-z0-9]/g, '');
            const isRTV = r.type?.toLowerCase() === 'series' || r.type?.toLowerCase() === 'anime';
            const sameType = isItemTV === isRTV;
            const titleMatch = normItemTitle === normRTitle || normItemTitle.startsWith(normRTitle) || normRTitle.startsWith(normItemTitle);
            return titleMatch && sameType;
          });

          if (existingCard) {
            // Check if status, link, or poster updated
            const statusChanged = existingCard.releaseType !== item.releaseType || existingCard.sourceUrl !== item.sourceUrl;
            
            // Update the single card in place
            await db.update(releases).set({
              title: item.title,
              year: item.year,
              type: item.type,
              provider: provider.name,
              sourceUrl: item.sourceUrl,
              releaseType: item.releaseType,
              poster: posterUrl,
              metadataJson: metadata,
              seeders: item.seeders || 0,
              leechers: item.leechers || 0,
            }).where(eq(releases.id, existingCard.id));

            // Update in-memory reference
            existingCard.releaseType = item.releaseType;
            existingCard.sourceUrl = item.sourceUrl;
            existingCard.poster = posterUrl;
            existingCard.metadataJson = metadata;

            if (statusChanged) {
              matchingCount++;
              await logSuccess(`Updated release card: ${item.title} (${item.year}) [${item.releaseType}]`, 'Matcher');
              matchedNotifications.push({ item, metadata: { ...metadata, poster: posterUrl } });
            } else {
              if (activeSettings.debugMode === 1) {
                await logDebug(`Release card up-to-date: ${item.title} (${item.releaseType})`, 'Scanner');
              }
            }
          } else {
            // Insert single new card for this title
            const [inserted] = await db.insert(releases).values({
              title: item.title,
              year: item.year,
              type: item.type,
              provider: provider.name,
              sourceUrl: item.sourceUrl,
              releaseType: item.releaseType,
              seeders: item.seeders || 0,
              leechers: item.leechers || 0,
              poster: posterUrl,
              metadataJson: metadata,
            }).returning();

            if (inserted) {
              existingReleases.push(inserted);
            }

            matchingCount++;
            await logSuccess(`Watchlist card created: ${item.title} (${item.year}) [${item.releaseType}]`, 'Matcher');
            matchedNotifications.push({ item, metadata: { ...metadata, poster: posterUrl } });
          }
        }

        // Send notifications for matches (new cards or status updates)
        for (const { item, metadata } of matchedNotifications) {
          try {
            await sendTelegramNotification({
              id: 0,
              ...item,
              provider: provider.name,
              poster: metadata?.poster || null,
              metadataJson: metadata,
              createdAt: new Date().toISOString()
            });
            notificationsCount++;
          } catch (notifErr: any) {
            await logError(`Failed to send notification: ${notifErr.message}`, 'Telegram');
          }
          
          // Wait 1 second before sending the next notification to avoid Telegram rate limits
          if (matchedNotifications.length > 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
        await logSuccess(`Matching watchlist:\n${matchingCount}`, 'Scanner');
        await logSuccess(`Notifications sent:\n${notificationsCount}`, 'Scanner');
        
        await logInfo(`Provider scan completed: ${provider.name}`, 'Provider');
      } catch (error: any) {
        console.error(`Error scanning provider ${provider.name}:`, error);
        await logError(`Provider connection failed: ${provider.name}`, 'Provider', { error: error.message });
      }
    }
  } catch (error: any) {
    console.error('Error during runScan execution:', error);
    await logError(`Error during runScan execution: ${error.message}`, 'Scanner');
  } finally {
    isScanning = false;
  }
  
  console.log('Provider scan finished.');
}
