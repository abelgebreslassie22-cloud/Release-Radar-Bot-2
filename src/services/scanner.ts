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

export async function syncWatchlistItemImmediately(wl: { title: string; year: number; type: string }): Promise<{ count: number; topSeeds: number; episodes: string[] }> {
  try {
    const isTV = wl.type?.toLowerCase() === 'series' || wl.type?.toLowerCase() === 'anime';
    const baseTitle = normalizeMediaTitle(wl.title);
    
    // 1. Fetch metadata & poster
    let metadata: any = await fetchMetadata(baseTitle, wl.year, wl.type);
    let posterUrl = metadata?.poster || null;

    if (!metadata) {
      metadata = {
        poster: posterUrl,
        overview: `Monitored watchlist item: ${wl.title} (${wl.year})`,
        sourceUrl: `https://www.themoviedb.org/search?query=${encodeURIComponent(wl.title)}`,
      };
    }
    if (!posterUrl) {
      posterUrl = generateCustomPoster({
        title: wl.title,
        year: wl.year,
        type: wl.type,
        releaseType: 'Monitored',
        sourceUrl: metadata?.sourceUrl || '',
        provider: 'Radar Monitor',
      });
      metadata.poster = posterUrl;
    }

    // 2. Search scene & web release indexers right there for all available qualities and seasons
    const downloadRadar = new DownloadRadarProvider();
    const downloadMatches = await downloadRadar.findDownloadsForTitle(wl.title, wl.year, wl.type);

    const downloads: any[] = [];
    const episodeCodes = new Set<string>();

    for (const dl of downloadMatches) {
      const alreadyHas = downloads.some(d => d.sourceUrl === dl.sourceUrl || d.title === dl.name);
      if (!alreadyHas) {
        const ep = extractEpisodeOrPack(dl.name) || extractEpisodeOrPack(dl.quality);
        if (ep) episodeCodes.add(ep.toUpperCase());

        downloads.push({
          id: Date.now() + Math.floor(Math.random() * 10000),
          title: dl.name,
          releaseType: `🟢 Download Available: ${dl.quality} (${dl.sizeText}) • ${dl.seeders} Seeds`,
          sourceUrl: dl.magnetUrl,
          seeders: dl.seeders || 0,
          leechers: dl.leechers || 0,
          createdAt: dl.uploadedAt ? dl.uploadedAt.toISOString() : new Date().toISOString()
        });
      }
    }

    downloads.sort((a, b) => (b.seeders || 0) - (a.seeders || 0));
    const topSeeds = downloads.reduce((max, d) => Math.max(max, d.seeders || 0), 0);
    const totalLeeches = downloads.reduce((sum, d) => sum + (d.leechers || 0), 0);
    const bestSourceUrl = downloads[0]?.sourceUrl || metadata?.sourceUrl || `https://www.themoviedb.org/search?query=${encodeURIComponent(wl.title)}`;

    const qualitySummary = downloads.length > 0
      ? `🟢 Download Available: ${downloads.length} Qualities • ${topSeeds} Seeds`
      : '🟡 Monitored (Searching for releases...)';

    const providerName = downloads.length > 0 ? 'Download Availability Radar' : 'Radar Monitor';

    // 3. Mark all current episodes as already known/notified so NO notifications are dispatched
    const notifiedEpisodes = Array.from(episodeCodes);
    const notifiedMovie = !isTV && downloads.length > 0;

    const metadataPayload = {
      ...metadata,
      downloads,
      initialSyncCompleted: true,
      notifiedEpisodes,
      notifiedMovie,
      lastSyncedAt: new Date().toISOString()
    };

    // 4. Create or update the single post card in releases table
    const existing = await db.select().from(releases).where(eq(releases.title, wl.title)).limit(1);

    if (existing.length > 0) {
      await db.update(releases).set({
        title: wl.title,
        year: wl.year,
        type: wl.type,
        provider: providerName,
        releaseType: qualitySummary,
        sourceUrl: bestSourceUrl,
        seeders: topSeeds,
        leechers: totalLeeches,
        poster: posterUrl || existing[0].poster,
        metadataJson: metadataPayload,
        updatedAt: new Date()
      }).where(eq(releases.id, existing[0].id));
    } else {
      await db.insert(releases).values({
        title: wl.title,
        year: wl.year,
        type: wl.type,
        provider: providerName,
        sourceUrl: bestSourceUrl,
        releaseType: qualitySummary,
        poster: posterUrl,
        metadataJson: metadataPayload,
        seeders: topSeeds,
        leechers: totalLeeches,
      }).onConflictDoNothing();
    }

    await logSuccess(`[Initial Search] Ingested ${downloads.length} quality release(s) for "${wl.title}" right away — 0 spam notifications sent.`, 'DownloadRadar');
    return { count: downloads.length, topSeeds, episodes: notifiedEpisodes };
  } catch (err: any) {
    console.error('Error during immediate watchlist item sync:', err);
    await logError(`Immediate sync error for "${wl.title}": ${err.message}`, 'Scanner');
    return { count: 0, topSeeds: 0, episodes: [] };
  }
}

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

    // Process each watchlist item: strictly maintain 1 card per movie/show in database
    for (const wl of items) {
      const normWlTitle = normalizeMediaTitle(wl.title).toLowerCase().replace(/[^a-z0-9]/g, '');
      const isTV = wl.type?.toLowerCase() === 'series' || wl.type?.toLowerCase() === 'anime';

      // Find all download releases for this title across qualities and episodes
      const matchingDlItems = downloadItems.filter(d => {
        const normDTitle = normalizeMediaTitle(d.title).toLowerCase().replace(/[^a-z0-9]/g, '');
        const isPartTwo = normDTitle.includes('parttwo') || normDTitle.includes('part2') || normDTitle.includes('partii');
        if (wl.title.toLowerCase().includes('part two') || wl.title.toLowerCase().includes('part 2')) {
          return isPartTwo;
        } else if (wl.title.toLowerCase() === 'dune') {
          return !isPartTwo && normDTitle.includes('dune') && !normDTitle.includes('prophecy');
        }
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

      // 1. Locate the single card for this movie/show in releases
      let movieCard = existingReleases.find(r => {
        const normRTitle = normalizeMediaTitle(r.title).toLowerCase().replace(/[^a-z0-9]/g, '');
        const isPartTwo = normRTitle.includes('parttwo') || normRTitle.includes('part2') || normRTitle.includes('partii');
        if (wl.title.toLowerCase().includes('part two') || wl.title.toLowerCase().includes('part 2')) {
          return isPartTwo;
        } else if (wl.title.toLowerCase() === 'dune') {
          return !isPartTwo && normRTitle.includes('dune') && !normRTitle.includes('prophecy');
        }
        return normRTitle === normWlTitle || r.title.toLowerCase() === wl.title.toLowerCase();
      });

      // If card doesn't exist yet, create it immediately
      if (!movieCard) {
        const [createdCard] = await db.insert(releases).values({
          title: wl.title,
          year: wl.year,
          type: wl.type,
          provider: 'Radar Monitor',
          sourceUrl: metadata?.sourceUrl || `https://www.themoviedb.org/search?query=${encodeURIComponent(wl.title)}`,
          releaseType: tmdbItem ? tmdbItem.releaseType : '🟡 Monitored (Searching for releases...)',
          poster: posterUrl,
          metadataJson: {
            ...metadata,
            downloads: []
          },
          seeders: 0,
          leechers: 0,
        }).onConflictDoNothing().returning();

        if (createdCard) {
          movieCard = createdCard;
          existingReleases.push(createdCard);
        } else {
          const found = await db.select().from(releases).where(eq(releases.title, wl.title)).limit(1);
          if (found.length > 0) {
            movieCard = found[0];
            existingReleases.push(found[0]);
          }
        }
      }

      if (!movieCard) continue;

      if (matchingDlItems.length > 0) {
        // Read existing downloads attached to this card
        const cardMeta = (movieCard.metadataJson as any) || {};
        const isInitialSync = cardMeta.initialSyncCompleted !== true;

        const currentDownloads: any[] = Array.isArray(cardMeta.downloads)
          ? [...cardMeta.downloads]
          : [];

        const notifiedEpisodes = new Set<string>(
          Array.isArray(cardMeta.notifiedEpisodes)
            ? cardMeta.notifiedEpisodes.map((e: string) => e.toUpperCase())
            : []
        );

        // Also add any episodes already in currentDownloads to notifiedEpisodes so we never re-alert
        for (const d of currentDownloads) {
          const ep = extractEpisodeOrPack(d.title) || extractEpisodeOrPack(d.releaseType);
          if (ep) notifiedEpisodes.add(ep.toUpperCase());
        }

        let notifiedMovie = Boolean(cardMeta.notifiedMovie) || (!isTV && currentDownloads.length > 0);
        let newlyDiscoveredCount = 0;
        const newEpisodeNotifications: any[] = [];

        for (const dl of matchingDlItems) {
          const existingIdx = currentDownloads.findIndex(d => 
            d.sourceUrl === dl.sourceUrl || d.title === dl.title
          );

          if (existingIdx !== -1) {
            currentDownloads[existingIdx].seeders = dl.seeders || 0;
            currentDownloads[existingIdx].leechers = dl.leechers || 0;
            currentDownloads[existingIdx].releaseType = dl.releaseType;
          } else {
            // Append new quality release to this movie's downloads
            const newDl = {
              id: Date.now() + Math.floor(Math.random() * 10000),
              title: dl.title,
              releaseType: dl.releaseType,
              sourceUrl: dl.sourceUrl,
              seeders: dl.seeders || 0,
              leechers: dl.leechers || 0,
              createdAt: new Date().toISOString()
            };
            currentDownloads.push(newDl);
            newlyDiscoveredCount++;

            // Strict notification logic:
            // 1. If this title is undergoing its initial sync, DO NOT notify (zero alert spam on addition!)
            // 2. If it's a TV show and not initial sync: notify ONE TIME only when a brand-new episode drops!
            // 3. If it's a movie and not initial sync: notify ONE TIME only when the movie first becomes downloadable!
            if (!isInitialSync) {
              if (isTV) {
                const ep = extractEpisodeOrPack(dl.title) || extractEpisodeOrPack(dl.releaseType);
                const epKey = ep ? ep.toUpperCase() : null;
                if (epKey && !notifiedEpisodes.has(epKey)) {
                  // Brand new episode dropped!
                  notifiedEpisodes.add(epKey);
                  newEpisodeNotifications.push({
                    ...movieCard,
                    title: dl.title,
                    releaseType: dl.releaseType,
                    sourceUrl: dl.sourceUrl,
                    poster: posterUrl || movieCard.poster
                  });
                  await logSuccess(`🔥 Brand new episode dropped: ${wl.title} ${epKey}`, 'DownloadRadar');
                }
              } else {
                if (!notifiedMovie && newEpisodeNotifications.length === 0) {
                  notifiedMovie = true;
                  newEpisodeNotifications.push({
                    ...movieCard,
                    title: dl.title,
                    releaseType: dl.releaseType,
                    sourceUrl: dl.sourceUrl,
                    poster: posterUrl || movieCard.poster
                  });
                  await logSuccess(`🔥 Movie newly available: ${wl.title}`, 'DownloadRadar');
                }
              }
            } else {
              // During initial sync, register all existing episodes so they never trigger future notifications
              if (isTV) {
                const ep = extractEpisodeOrPack(dl.title) || extractEpisodeOrPack(dl.releaseType);
                if (ep) notifiedEpisodes.add(ep.toUpperCase());
              } else {
                notifiedMovie = true;
              }
            }
          }
        }

        // Sort qualities by seeders desc
        currentDownloads.sort((a, b) => (b.seeders || 0) - (a.seeders || 0));

        const topSeeds = currentDownloads.reduce((max, d) => Math.max(max, d.seeders || 0), 0);
        const totalLeeches = currentDownloads.reduce((sum, d) => sum + (d.leechers || 0), 0);
        const bestQualitySummary = `🟢 Download Available: ${currentDownloads.length} Qualities • ${topSeeds} Seeds`;
        const bestSourceUrl = currentDownloads[0]?.sourceUrl || movieCard.sourceUrl;

        // Update the SINGLE movie card in releases table (NO duplicate cards created!)
        await db.update(releases).set({
          title: wl.title,
          year: wl.year,
          type: wl.type,
          provider: 'Download Availability Radar',
          releaseType: bestQualitySummary,
          sourceUrl: bestSourceUrl,
          seeders: topSeeds,
          leechers: totalLeeches,
          poster: posterUrl || movieCard.poster,
          metadataJson: {
            ...metadata,
            downloads: currentDownloads,
            initialSyncCompleted: true,
            notifiedEpisodes: Array.from(notifiedEpisodes),
            notifiedMovie,
            lastSyncedAt: new Date().toISOString()
          },
          updatedAt: new Date()
        }).where(eq(releases.id, movieCard.id));

        if (newlyDiscoveredCount > 0) {
          await logInfo(`Updated "${wl.title}" card with ${newlyDiscoveredCount} newly discovered quality release(s)`, 'DownloadRadar');
        }

        if (newEpisodeNotifications.length > 0) {
          for (const itemToNotify of newEpisodeNotifications) {
            notificationsToSend.push(itemToNotify);
          }
        }
      } else {
        // No download files online yet: ensure card status is kept up to date
        const cardMeta = (movieCard.metadataJson as any) || {};
        const finalStatus = tmdbItem ? tmdbItem.releaseType : `🟡 Monitored (Searching for releases...)`;
        const finalSourceUrl = tmdbItem ? tmdbItem.sourceUrl : (metadata?.sourceUrl || `https://www.themoviedb.org/search?query=${encodeURIComponent(wl.title)}`);
        const finalProvider = tmdbItem ? 'TMDB Premiere Radar' : 'Radar Monitor';

        await db.update(releases).set({
          title: wl.title,
          year: wl.year,
          type: wl.type,
          provider: finalProvider,
          sourceUrl: finalSourceUrl,
          releaseType: finalStatus,
          poster: posterUrl || movieCard.poster,
          metadataJson: {
            ...metadata,
            downloads: cardMeta.downloads || [],
            initialSyncCompleted: true,
            notifiedEpisodes: cardMeta.notifiedEpisodes || [],
            notifiedMovie: cardMeta.notifiedMovie || false
          },
          updatedAt: new Date()
        }).where(eq(releases.id, movieCard.id));
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
