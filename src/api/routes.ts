import { Express, Request, Response } from 'express';
import { db } from '../database/db';
import { watchlist, releases } from '../database/schema';
import { getSettings, updateSettings } from '../services/settings';
import { restartScheduler } from '../scheduler/cron';
import { eq, desc, count, inArray } from 'drizzle-orm';
import { searchMedia } from '../metadata/tmdb';
import { runScan, syncWatchlistItemImmediately } from '../services/scanner';
import { supervisor } from '../services/keepalive';
import { getDiscoveredReleases, getDiscoveredReleaseById, scanForNewReleases, addDiscoveredToWatchlist, deleteDiscoveredRelease, purgeOldShowsFromDiscovered } from '../services/discover';
import { getCalendarSchedule } from '../services/calendar';
import { getSeriesEpisodesProgress } from '../services/episodeTracker';
import { matchesCategory } from '../utils/categoryHelper';
import { normalizeMediaTitle } from '../utils/mediaGrouper';
import { deleteAndBlacklistDownload, loadIgnoredCache, extractMagnetHash, normalizeDownloadTitle } from '../services/ignoredDownloads';

export function setupRoutes(app: Express) {
  // Global ingress host tracker middleware
  app.use((req: Request, _res: Response, next) => {
    const hostHeader = (req.headers['x-forwarded-host'] || req.headers.host) as string | undefined;
    const protoHeader = (req.headers['x-forwarded-proto'] || req.protocol) as string | undefined;
    if (hostHeader) {
      supervisor.registerIngressHost(hostHeader, protoHeader);
    }
    next();
  });

  // Dynamic Ingress Health Check Endpoint
  app.get(['/health', '/api/health', '/api/ping'], (req: Request, res: Response) => {
    const isInternal = req.headers['x-keepalive-internal'] === 'true';
    const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress) as string | undefined;
    const userAgent = req.headers['user-agent'] as string | undefined;

    supervisor.recordInboundPing(clientIp, userAgent, isInternal);
    const state = supervisor.getState();

    res.status(200).json({
      status: 'ok',
      service: 'Release Radar 24/7',
      serverUptime: Math.floor(process.uptime()),
      botUptime: state.botStartedAt ? Math.floor((Date.now() - new Date(state.botStartedAt).getTime()) / 1000) : 0,
      botRunning: state.botRunning,
      botRestartCount: state.botRestartCount,
      lastExternalPingReceived: state.lastExternalPingReceived,
      externalPingCount: state.externalPingCount,
      detectedPublicUrl: state.detectedPublicUrl,
      outboundLoopIntervalSec: state.outboundLoopIntervalSec,
      lastOutboundPing: state.lastOutboundPing,
      timestamp: new Date().toISOString()
    });
  });

  // Detailed Keep-Alive & Supervisor Status
  app.get('/api/keepalive/status', (_req: Request, res: Response) => {
    try {
      const state = supervisor.getState();
      const memoryUsage = process.memoryUsage();
      res.status(200).json({
        ...state,
        memoryRssMb: Math.round(memoryUsage.rss / 1024 / 1024),
        memoryHeapUsedMb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        nodeVersion: process.version,
        platform: process.platform,
        serverUptime: Math.floor(process.uptime())
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to fetch keepalive status' });
    }
  });

  // Instant Manual Ingress Latency Test / Ping Now
  app.post('/api/keepalive/ping-now', async (_req: Request, res: Response) => {
    try {
      const result = await supervisor.pingNow();
      res.status(200).json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message || 'Ping failed' });
    }
  });


  // Media Search via TMDB for real-time picker
  app.get('/api/media/search', async (req: Request, res: Response) => {
    try {
      const query = (req.query.query as string || '').trim();
      if (!query) {
        return res.json([]);
      }
      const results = await searchMedia(query);
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to search media' });
    }
  });

  // Watchlist
  app.get('/api/watchlist', async (req: Request, res: Response) => {
    try {
      const items = await db.select().from(watchlist).orderBy(desc(watchlist.createdAt));
      res.json(items);
    } catch (e: any) { 
      res.json([]); 
    }
  });

  app.post('/api/watchlist', async (req: Request, res: Response) => {
    try {
      const { title, year, type } = req.body;
      const parsedYear = Number(year);
      if (!title || !parsedYear || isNaN(parsedYear) || !type) {
        return res.status(400).json({ error: 'Missing or invalid required fields: title, year, type' });
      }
      await db.insert(watchlist).values({ title, year: parsedYear, type });

      // THE MOMENT IT IS ADDED: Search indexers right there and create card with all qualities and zero notifications
      (async () => {
        try {
          await syncWatchlistItemImmediately({ title, year: parsedYear, type });
        } catch (cardErr) {
          console.error('Error auto-creating release card upon watchlist addition:', cardErr);
        }
      })();

      res.status(201).json({ success: true });
    } catch (e: any) { 
      if (e.code === '23505' || e.message?.includes('unique') || e.message?.includes('duplicate')) {
        return res.status(400).json({ error: 'This item (Title, Year, and Type) is already in your watchlist.' });
      }
      res.status(500).json({ error: e.message || 'Failed to add item.' }); 
    }
  });

  app.put('/api/watchlist/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
      
      const { title, year, type } = req.body;
      const parsedYear = Number(year);
      if (!title || !parsedYear || isNaN(parsedYear) || !type) {
        return res.status(400).json({ error: 'Missing or invalid required fields: title, year, type' });
      }
      
      await db.update(watchlist)
        .set({ title, year: parsedYear, type, updatedAt: new Date() })
        .where(eq(watchlist.id, id));
      res.json({ success: true });
    } catch (e: any) { 
      if (e.code === '23505' || e.message?.includes('unique') || e.message?.includes('duplicate')) {
        return res.status(400).json({ error: 'This item (Title, Year, and Type) is already in your watchlist.' });
      }
      res.status(500).json({ error: e.message || 'Failed to update item' }); 
    }
  });

  app.delete('/api/watchlist/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

      const item = await db.select().from(watchlist).where(eq(watchlist.id, id)).limit(1);
      if (item.length > 0) {
        await db.delete(watchlist).where(eq(watchlist.id, id));
        // Also remove the corresponding single card for this title
        await db.delete(releases).where(eq(releases.title, item[0].title));
      }
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message || 'Failed to delete item' }); }
  });

  // Releases (category-aware, with blacklisted/ignored downloads filtered out)
  app.get('/api/releases', async (req: Request, res: Response) => {
    try {
      const categoryParam = req.query.category as string | undefined;
      const items = await db.select().from(releases).orderBy(desc(releases.createdAt));
      const { hashes, urls, titles } = await loadIgnoredCache();

      const sanitizedItems = items.map(r => {
        const meta = r.metadataJson as any;
        if (meta && Array.isArray(meta.downloads) && meta.downloads.length > 0) {
          const cleanDls = meta.downloads.filter((d: any) => {
            const url = d.sourceUrl || d.magnetUrl;
            if (url) {
              if (urls.has(url)) return false;
              const h = extractMagnetHash(url);
              if (h && hashes.has(h)) return false;
            }
            if (d.title && titles.has(normalizeDownloadTitle(d.title))) return false;
            return true;
          });
          if (cleanDls.length !== meta.downloads.length) {
            return {
              ...r,
              metadataJson: {
                ...meta,
                downloads: cleanDls
              }
            };
          }
        }
        return r;
      });

      if (categoryParam && categoryParam !== 'All') {
        const filtered = sanitizedItems.filter(r => matchesCategory(r, categoryParam));
        return res.json(filtered);
      }

      res.json(sanitizedItems);
    } catch (e: any) { res.json([]); }
  });

  // Discover: Get freshly discovered American releases (movies & TV shows)
  app.get('/api/discover', async (req: Request, res: Response) => {
    try {
      const category = req.query.category as string | undefined;
      const search = req.query.search as string | undefined;
      const data = await getDiscoveredReleases({ category, search });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to fetch discovered releases' });
    }
  });

  // Discover: Get single discovered release by ID (with blacklisted downloads filtered out)
  app.get('/api/discover/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
      const item = await getDiscoveredReleaseById(id);
      if (!item) return res.status(404).json({ error: 'Discovered release not found' });

      const { hashes, urls, titles } = await loadIgnoredCache();
      if (Array.isArray(item.downloads)) {
        item.downloads = item.downloads.filter((d: any) => {
          const url = d.sourceUrl || d.magnetUrl;
          if (url) {
            if (urls.has(url)) return false;
            const h = extractMagnetHash(url);
            if (h && hashes.has(h)) return false;
          }
          if (d.title && titles.has(normalizeDownloadTitle(d.title))) return false;
          return true;
        });
      }

      res.json(item);
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to fetch discovered release' });
    }
  });

  // Discover: Trigger manual discovery scan for fresh US releases
  app.post('/api/discover/scan', async (_req: Request, res: Response) => {
    try {
      const result = await scanForNewReleases();
      res.json({ success: true, ...result });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message || 'Discovery scan failed' });
    }
  });

  // Discover: 1-Click Toggle (Add or Remove) discovered title from active monitored Watchlist
  app.post(['/api/discover/add-to-watchlist', '/api/discover/toggle-watchlist'], async (req: Request, res: Response) => {
    try {
      const { id } = req.body;
      const parsedId = parseInt(id, 10);
      if (isNaN(parsedId)) {
        return res.status(400).json({ error: 'Invalid discovered release ID' });
      }
      const result = await addDiscoveredToWatchlist(parsedId);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      res.json({ 
        success: true, 
        inWatchlist: result.inWatchlist, 
        action: result.action, 
        item: result.item 
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to toggle watchlist' });
    }
  });

  // Discover: Delete single discovered release card
  app.delete('/api/discover/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
      const success = await deleteDiscoveredRelease(id);
      res.json({ success });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to delete discovered release' });
    }
  });

  // Discover: Purge all ended/old show cards
  app.post('/api/discover/purge-old', async (_req: Request, res: Response) => {
    try {
      const count = await purgeOldShowsFromDiscovered();
      res.json({ success: true, count });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to purge old shows' });
    }
  });

  // Drop Calendar API: Airing Schedule & Torrent Availability
  app.get('/api/calendar', async (req: Request, res: Response) => {
    try {
      const daysPast = req.query.daysPast ? parseInt(req.query.daysPast as string, 10) : 2;
      const daysAhead = req.query.daysAhead ? parseInt(req.query.daysAhead as string, 10) : 11;
      const category = (req.query.category as string) || 'All';
      const watchlistOnly = req.query.watchlistOnly === 'true';
      const refresh = req.query.refresh === 'true';

      const schedule = await getCalendarSchedule({ daysPast, daysAhead, category, watchlistOnly, refresh });
      res.json(schedule);
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to fetch calendar schedule' });
    }
  });

  // Series Episode Progress Tracker API
  app.get('/api/series/episodes', async (req: Request, res: Response) => {
    try {
      const title = req.query.title as string;
      if (!title) return res.status(400).json({ error: 'Title is required' });

      const tmdbId = req.query.tmdbId ? parseInt(req.query.tmdbId as string, 10) : undefined;
      const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
      const seasonNumber = req.query.season ? parseInt(req.query.season as string, 10) : undefined;

      const progress = await getSeriesEpisodesProgress({ tmdbId, title, year, seasonNumber });
      if (!progress) {
        return res.status(404).json({ error: 'Could not fetch series episodes' });
      }
      res.json(progress);
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to fetch episode progress' });
    }
  });

  // Permanently delete a single download quality/episode and blacklist it so it never reappears
  app.post(['/api/releases/delete-single', '/api/releases/blacklist-download'], async (req: Request, res: Response) => {
    try {
      const { id, title, sourceUrl, seriesTitle, groupKey } = req.body;
      if (!title && !sourceUrl && !id) {
        return res.status(400).json({ error: 'Missing release identifier' });
      }

      const result = await deleteAndBlacklistDownload({
        id,
        title,
        sourceUrl,
        seriesTitle,
        groupKey,
        reason: 'user_deleted_single_quality'
      });

      res.json({ success: true, ...result });
    } catch (e: any) {
      console.error('Error in POST /api/releases/delete-single:', e);
      res.status(500).json({ error: e.message || 'Failed to delete and blacklist release' });
    }
  });

  app.delete('/api/releases/:id', async (req: Request, res: Response) => {
    try {
      const paramId = String(req.params.id || '').trim();
      const numId = Number(paramId);
      const isSafeInt = !isNaN(numId) && Number.isInteger(numId) && numId > 0 && numId <= 2147483647;

      const bodyTitle = req.body?.title as string | undefined;
      const bodySourceUrl = req.body?.sourceUrl as string | undefined;
      const bodySeriesTitle = req.body?.seriesTitle as string | undefined;

      // If title or sourceUrl was explicitly sent for a single download, blacklist it directly
      if (bodyTitle || bodySourceUrl) {
        await deleteAndBlacklistDownload({
          id: isSafeInt ? numId : paramId,
          title: bodyTitle || '',
          sourceUrl: bodySourceUrl,
          seriesTitle: bodySeriesTitle,
          reason: 'user_deleted_single_quality'
        });
        return res.json({ success: true, blacklisted: true });
      }

      const allCards = await db.select().from(releases);
      const cardIdsToDelete = new Set<number>();

      for (const card of allCards) {
        if (isSafeInt && card.id === numId) {
          cardIdsToDelete.add(card.id);
          continue;
        }

        const cardCanonical = normalizeMediaTitle(card.title).toLowerCase();
        if (
          cardCanonical === normalizeMediaTitle(paramId).toLowerCase() ||
          card.title.toLowerCase() === paramId.toLowerCase()
        ) {
          cardIdsToDelete.add(card.id);
          continue;
        }

        // Check if paramId matches a specific download inside metadataJson.downloads
        const dls = Array.isArray((card.metadataJson as any)?.downloads) ? (card.metadataJson as any).downloads : [];
        const matchedDls = dls.filter((d: any) => String(d.id) === paramId || String(d.sourceUrl) === paramId);
        const remainingDls = dls.filter((d: any) => String(d.id) !== paramId && String(d.sourceUrl) !== paramId);

        if (matchedDls.length > 0) {
          // Permanently blacklist each matched download!
          for (const m of matchedDls) {
            await deleteAndBlacklistDownload({
              id: m.id,
              title: m.title || card.title,
              sourceUrl: m.sourceUrl || m.magnetUrl,
              seriesTitle: card.title,
              reason: 'user_deleted_download_id'
            });
          }

          if (remainingDls.length === 0) {
            cardIdsToDelete.add(card.id);
          } else {
            const topSeeds = remainingDls.reduce((max: number, d: any) => Math.max(max, d.seeders || 0), 0);
            await db.update(releases).set({
              metadataJson: {
                ...(card.metadataJson as any || {}),
                downloads: remainingDls
              },
              seeders: topSeeds,
              releaseType: `🟢 Download Available: ${remainingDls.length} Qualities • ${topSeeds} Seeds`,
              updatedAt: new Date()
            }).where(eq(releases.id, card.id));
          }
        }
      }

      const safeIds = Array.from(cardIdsToDelete).filter(id => Number.isInteger(id) && id > 0 && id <= 2147483647);
      if (safeIds.length > 0) {
        await db.delete(releases).where(inArray(releases.id, safeIds));
      }

      res.json({ success: true, deletedCount: safeIds.length });
    } catch (e: any) {
      console.error('Error in DELETE /api/releases/:id:', e);
      res.status(500).json({ error: e.message || 'Failed to delete release' });
    }
  });

  app.post('/api/releases/delete-batch', async (req: Request, res: Response) => {
    try {
      const { ids, dbReleaseIds, canonicalTitle, groupKey, title, rawTitles } = req.body;
      const targetDbIds = new Set<number>();

      // 1. Process explicit dbReleaseIds (only positive 32-bit integers)
      if (Array.isArray(dbReleaseIds)) {
        for (const id of dbReleaseIds) {
          const num = Number(id);
          if (!isNaN(num) && Number.isInteger(num) && num > 0 && num <= 2147483647) {
            targetDbIds.add(num);
          }
        }
      }

      // Collect all string representations of ids
      const requestedIdStrings = new Set<string>();
      if (Array.isArray(ids)) {
        for (const id of ids) {
          if (id !== undefined && id !== null) {
            requestedIdStrings.add(String(id));
            const num = Number(id);
            if (!isNaN(num) && Number.isInteger(num) && num > 0 && num <= 2147483647) {
              targetDbIds.add(num);
            }
          }
        }
      }

      const allCards = await db.select().from(releases);

      const targetCanonical = (canonicalTitle || title || '').trim().toLowerCase();
      const targetCleanCanonical = normalizeMediaTitle(targetCanonical).toLowerCase();
      const targetGroupKey = (groupKey || '').trim().toLowerCase();

      const rawTitlesSet = new Set<string>();
      if (Array.isArray(rawTitles)) {
        rawTitles.forEach(t => { if (t) rawTitlesSet.add(String(t).toLowerCase()); });
      }

      for (const card of allCards) {
        if (targetDbIds.has(card.id)) continue;

        // Direct ID match from requested string IDs
        if (requestedIdStrings.has(String(card.id))) {
          targetDbIds.add(card.id);
          continue;
        }

        const cardTitle = card.title.toLowerCase();
        const cardCanonical = normalizeMediaTitle(card.title).toLowerCase();
        const cardCleanKey = cardCanonical.replace(/[^a-z0-9]/g, '');

        if (rawTitlesSet.has(cardTitle)) {
          targetDbIds.add(card.id);
          continue;
        }

        if (
          (targetCanonical && (
            cardCanonical === targetCanonical ||
            cardTitle === targetCanonical ||
            cardCanonical === targetCleanCanonical
          )) ||
          (targetGroupKey && (
            cardCleanKey === targetGroupKey ||
            cardTitle.replace(/[^a-z0-9]/g, '') === targetGroupKey
          ))
        ) {
          targetDbIds.add(card.id);
          continue;
        }

        // Check if any download in card.metadataJson.downloads matches one of the requested ids
        if (card.metadataJson && Array.isArray((card.metadataJson as any).downloads)) {
          const dls = (card.metadataJson as any).downloads;
          const hasMatchingDl = dls.some((dl: any) => 
            requestedIdStrings.has(String(dl.id)) || 
            (dl.sourceUrl && requestedIdStrings.has(String(dl.sourceUrl)))
          );
          if (hasMatchingDl) {
            targetDbIds.add(card.id);
            continue;
          }
        }
      }

      // Safe filtering: ONLY delete valid PostgreSQL 32-bit integer IDs
      const safeIdsToDelete = Array.from(targetDbIds).filter(
        id => typeof id === 'number' && Number.isInteger(id) && id > 0 && id <= 2147483647
      );

      if (safeIdsToDelete.length > 0) {
        await db.delete(releases).where(inArray(releases.id, safeIdsToDelete));
      }

      res.json({ success: true, deletedCount: safeIdsToDelete.length });
    } catch (e: any) {
      console.error('Error in POST /api/releases/delete-batch:', e);
      res.status(500).json({ error: e.message || 'Failed to delete releases' });
    }
  });

  // Settings & Env Configuration
  app.get('/api/settings', async (req: Request, res: Response) => {
    try {
      const settings = await getSettings();
      res.json(settings || {});
    } catch (e: any) { res.json({}); }
  });

  // Get current environment & connection status
  app.get('/api/config/env-status', async (req: Request, res: Response) => {
    try {
      let isDbConnected = false;
      let dbError: string | null = null;
      if (process.env.DATABASE_URL) {
        try {
          await db.select({ count: count() }).from(watchlist);
          isDbConnected = true;
        } catch (e: any) {
          dbError = e.message;
        }
      }

      const settings = await getSettings();
      
      const mask = (val?: string) => {
        if (!val || val.length < 8) return val ? '••••••••' : '';
        return val.substring(0, 4) + '••••••••' + val.substring(val.length - 4);
      };

      const activeToken = (settings?.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();

      res.json({
        hasDatabaseUrl: !!process.env.DATABASE_URL,
        databaseUrlMasked: mask(process.env.DATABASE_URL),
        isDbConnected,
        dbError,
        hasTelegramToken: !!activeToken,
        telegramTokenMasked: mask(activeToken),
        telegramChatId: settings?.telegramChatId || process.env.TELEGRAM_CHAT_ID || '',
        metadataApiKeyMasked: mask(settings?.metadataApiKey || process.env.TMDB_API_KEY),
        appUrl: settings?.appUrl || process.env.APP_URL || '',
        providerType: settings?.providerType || 'TMDB',
        scanInterval: settings?.scanInterval || 10,
        debugMode: settings?.debugMode || 0,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Test standalone database connection
  app.post('/api/config/test-db', async (req: Request, res: Response) => {
    try {
      const { databaseUrl } = req.body;
      if (!databaseUrl || !databaseUrl.trim()) {
        return res.status(400).json({ error: 'Database URL is required' });
      }
      const { reconnectDatabase } = await import('../database/db');
      const result = await reconnectDatabase(databaseUrl.trim());
      if (result.success) {
        res.json({ success: true, message: 'Connected to PostgreSQL and verified schema successfully!' });
      } else {
        res.status(400).json({ error: result.error || 'Failed to connect to database' });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Database test connection failed' });
    }
  });

  // Test standalone Telegram token
  app.post('/api/config/test-telegram', async (req: Request, res: Response) => {
    try {
      const { token } = req.body;
      if (!token || !token.trim()) {
        return res.status(400).json({ error: 'Telegram bot token is required' });
      }
      const testRes = await fetch(`https://api.telegram.org/bot${token.trim()}/getMe`);
      const testData: any = await testRes.json();
      if (testData.ok) {
        res.json({ success: true, bot: testData.result });
      } else {
        res.status(400).json({ error: testData.description || 'Invalid Telegram bot token' });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Telegram test failed' });
    }
  });

  // Test standalone TMDB API key
  app.post('/api/config/test-tmdb', async (req: Request, res: Response) => {
    try {
      const { apiKey } = req.body;
      if (!apiKey || !apiKey.trim()) {
        return res.status(400).json({ error: 'TMDB API key is required' });
      }
      const testRes = await fetch(`https://api.themoviedb.org/3/configuration?api_key=${apiKey.trim()}`);
      const testData: any = await testRes.json();
      if (testRes.ok && testData.images) {
        res.json({ success: true, message: 'TMDB API Key is valid and active!' });
      } else {
        res.status(400).json({ error: testData.status_message || 'Invalid TMDB API Key' });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'TMDB validation failed' });
    }
  });

  // MASTER ENDPOINT: Save and automatically connect ALL services at once!
  app.post('/api/config/connect-all', async (req: Request, res: Response) => {
    const results: any = {
      database: { status: 'skipped', message: 'No change' },
      telegram: { status: 'skipped', message: 'No change' },
      tmdb: { status: 'skipped', message: 'No change' },
      scheduler: { status: 'skipped', message: 'No change' }
    };

    try {
      let { 
        databaseUrl, 
        telegramBotToken, 
        telegramChatId, 
        metadataApiKey, 
        appUrl, 
        scanInterval, 
        providerType, 
        providerUrl, 
        debugMode,
        rawEnv 
      } = req.body;

      // If user pasted raw .env text, parse key-value pairs
      if (rawEnv && typeof rawEnv === 'string' && rawEnv.trim()) {
        const lines = rawEnv.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.substring(0, eqIdx).trim();
            const val = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
            if (key === 'DATABASE_URL' && !databaseUrl) databaseUrl = val;
            if (key === 'TELEGRAM_BOT_TOKEN' && !telegramBotToken) telegramBotToken = val;
            if (key === 'TELEGRAM_CHAT_ID' && !telegramChatId) telegramChatId = val;
            if ((key === 'TMDB_API_KEY' || key === 'METADATA_API_KEY') && !metadataApiKey) metadataApiKey = val;
            if (key === 'APP_URL' && !appUrl) appUrl = val;
            if (key === 'SCAN_INTERVAL' && !scanInterval) scanInterval = parseInt(val, 10);
            if (key === 'PROVIDER_TYPE' && !providerType) providerType = val;
            if (key === 'PROVIDER_URL' && !providerUrl) providerUrl = val;
          }
        }
      }

      // 1. Connect Database
      if (databaseUrl && databaseUrl.trim()) {
        try {
          const { reconnectDatabase } = await import('../database/db');
          const dbRes = await reconnectDatabase(databaseUrl.trim());
          if (dbRes.success) {
            results.database = { status: 'success', message: 'Connected & schema verified successfully' };
            const { logSuccess } = await import('../services/logger');
            logSuccess('Database connected via UI Settings', 'Database').catch(() => {});
          } else {
            results.database = { status: 'error', message: dbRes.error || 'Failed to connect' };
          }
        } catch (e: any) {
          results.database = { status: 'error', message: e.message };
        }
      } else if (process.env.DATABASE_URL) {
        try {
          await db.select({ count: count() }).from(watchlist);
          results.database = { status: 'success', message: 'Already connected' };
        } catch (e: any) {
          results.database = { status: 'error', message: e.message };
        }
      }

      // 2. TMDB Key verification
      if (metadataApiKey !== undefined) {
        if (metadataApiKey && metadataApiKey.trim()) {
          try {
            const tmdbRes = await fetch(`https://api.themoviedb.org/3/configuration?api_key=${metadataApiKey.trim()}`);
            if (tmdbRes.ok) {
              results.tmdb = { status: 'success', message: 'TMDB API key verified successfully' };
            } else {
              results.tmdb = { status: 'warning', message: 'Key saved, but TMDB returned an authorization error' };
            }
          } catch (e: any) {
            results.tmdb = { status: 'warning', message: `Saved, but verification timed out: ${e.message}` };
          }
        } else {
          results.tmdb = { status: 'info', message: 'TMDB key cleared' };
        }
      }

      // 3. Update Database Settings (ChatId, Metadata Key, AppUrl, Interval, Provider, Bot Token)
      try {
        const updatePayload: any = {};
        if (telegramBotToken !== undefined && telegramBotToken.trim()) updatePayload.telegramBotToken = telegramBotToken.trim();
        if (telegramChatId !== undefined) updatePayload.telegramChatId = telegramChatId.trim();
        if (metadataApiKey !== undefined) updatePayload.metadataApiKey = metadataApiKey.trim();
        if (appUrl !== undefined) updatePayload.appUrl = appUrl.trim();
        if (scanInterval !== undefined) updatePayload.scanInterval = Number(scanInterval);
        if (providerType !== undefined) updatePayload.providerType = providerType;
        if (providerUrl !== undefined) updatePayload.providerUrl = providerUrl;
        if (debugMode !== undefined) updatePayload.debugMode = Number(debugMode);

        if (Object.keys(updatePayload).length > 0) {
          await updateSettings(updatePayload);
        }
      } catch (e: any) {
        console.error('Settings update error:', e);
      }

      // 4. Initialize / Reconnect Telegram Bot
      if (telegramBotToken !== undefined && telegramBotToken.trim()) {
        try {
          const { initTelegramBot } = await import('../telegram/bot');
          const botRes = await initTelegramBot(telegramBotToken.trim(), appUrl);
          if (botRes.success) {
            results.telegram = { 
              status: 'success', 
              message: `Bot connected as @${botRes.botInfo?.username || 'ReleaseRadarBot'}` 
            };
          } else {
            results.telegram = { status: 'error', message: botRes.error || 'Failed to start bot' };
          }
        } catch (e: any) {
          results.telegram = { status: 'error', message: e.message };
        }
      } else if (process.env.TELEGRAM_BOT_TOKEN) {
        results.telegram = { status: 'success', message: 'Active with existing token' };
      }

      // 5. Restart Scheduler with updated settings
      try {
        restartScheduler();
        results.scheduler = { status: 'success', message: 'Scheduler active and scanning' };
      } catch (e: any) {
        results.scheduler = { status: 'warning', message: e.message };
      }

      res.json({
        success: results.database.status !== 'error' && results.telegram.status !== 'error',
        results
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message, results });
    }
  });

  // Direct test telegram alert endpoint
  app.post(['/api/config/test-alert', '/api/telegram/test'], async (req: Request, res: Response) => {
    try {
      const { token, chatId } = req.body || {};
      const { sendTestTelegramAlert } = await import('../telegram/bot');
      const result = await sendTestTelegramAlert(token, chatId);
      if (result.success) {
        res.json({ success: true, message: 'Test alert sent! Check your Telegram chat.' });
      } else {
        res.status(400).json({ error: result.error || 'Failed to send test alert' });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/scan', async (req: Request, res: Response) => {
    try {
      // Execute without waiting so it doesn't timeout the request
      import('../services/scanner').then(({ runScan }) => runScan().catch(e => console.error('Scan error:', e)));
      res.json({ success: true, message: 'Scan started in background' });
    } catch (e: any) { res.status(500).json({ error: e.message || 'Failed to start scan' }); }
  });

  app.put('/api/settings', async (req: Request, res: Response) => {
    try {
      const { scanInterval, telegramChatId, metadataApiKey, debugMode, providerType, providerUrl, appUrl } = req.body;
      
      if (scanInterval !== undefined && (typeof scanInterval !== 'number' || scanInterval < 1)) {
        return res.status(400).json({ error: 'Invalid scan interval' });
      }

      await updateSettings({ scanInterval, telegramChatId, metadataApiKey, debugMode, providerType, providerUrl, appUrl });
      
      if (scanInterval) {
        restartScheduler();
      }
      
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message || 'Failed to update settings' }); }
  });

  app.post('/api/telegram/test', async (req: Request, res: Response) => {
    try {
      const { sendTestTelegramNotification } = await import('../telegram/bot');
      const result = await sendTestTelegramNotification();
      if (result.success) {
        res.json({ success: true, message: 'Test message sent to Telegram with detail page link!' });
      } else {
        res.status(400).json({ error: result.error || 'Failed to send test message' });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to send Telegram test message' });
    }
  });

  app.post('/api/telegram/webhook', async (req: Request, res: Response) => {
    try {
      const { processTelegramUpdate } = await import('../telegram/bot');
      processTelegramUpdate(req.body);
      res.sendStatus(200);
    } catch (e: any) {
      console.error('Webhook error:', e);
      res.sendStatus(500);
    }
  });
  
  // Logs
  app.get('/api/logs', async (req: Request, res: Response) => {
    try {
      const { logs } = await import('../database/schema');
      const items = await db.select().from(logs).orderBy(desc(logs.createdAt)).limit(200);
      res.json(items);
    } catch (e: any) {
      res.status(500).json({ error: 'Failed to fetch logs' });
    }
  });

  app.delete('/api/logs', async (req: Request, res: Response) => {
    try {
      const { logs } = await import('../database/schema');
      await db.delete(logs);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: 'Failed to clear logs' });
    }
  });

  // Provider testing
  app.post('/api/provider/test', async (req: Request, res: Response) => {
    try {
      const { providerType, providerUrl } = req.body;
      let ProviderClass;
      
      if (providerType === 'TMDB') {
        const { TMDBPremiereProvider } = await import('../providers/tmdbProvider');
        const provider = new TMDBPremiereProvider();
        const items = await provider.scan();
        return res.json({ success: true, itemsFound: items.length });
      } else if (providerType === 'MOCK') {
        const { MockRSSProvider } = await import('../providers/mockRssProvider');
        const provider = new MockRSSProvider();
        const items = await provider.scan();
        return res.json({ success: true, itemsFound: items.length });
      } else if (providerType === 'RSS') {
        if (!providerUrl) {
          return res.status(400).json({ error: 'RSS URL is required' });
        }
        const { RSSProvider } = await import('../providers/rssProvider');
        const provider = new RSSProvider(providerUrl);
        const items = await provider.scan();
        return res.json({ success: true, itemsFound: items.length });
      } else {
        return res.status(400).json({ error: 'Invalid or missing provider configuration' });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Provider connection failed' });
    }
  });

  // Dashboard stats
  app.get('/api/dashboard', async (req: Request, res: Response) => {
    try {
      const [{ value: watchlistCount }] = await db.select({ value: count() }).from(watchlist);
      const [{ value: releaseCount }] = await db.select({ value: count() }).from(releases);
      const settings = await getSettings();
      
      res.json({
        watchlistCount,
        releaseCount,
        lastScan: settings?.lastScan,
        scanInterval: settings?.scanInterval || 10,
        providerType: settings?.providerType || 'NONE'
      });
    } catch (e: any) { 
      res.json({ watchlistCount: 0, releaseCount: 0, lastScan: null, scanInterval: 10, error: 'Database connection required', providerType: 'NONE' });
    }
  });

  // Health Status
  app.get('/api/health/status', async (req: Request, res: Response) => {
    try {
      let dbStatus = 'Not Configured';
      if (process.env.DATABASE_URL) {
        try {
          const result = await db.select().from(watchlist).limit(1);
          if (result !== undefined) dbStatus = 'Healthy';
        } catch (e) {
          dbStatus = 'Error';
        }
      }
      
      const settings = await getSettings();
      const providerName = settings?.providerType === 'TMDB' ? 'TMDB Digital & TV Premieres' : (settings?.providerType === 'RSS' ? 'RSS Feed' : (settings?.providerType === 'MOCK' ? 'MockRSS' : 'None'));
      res.json({
        server: 'Healthy',
        database: dbStatus,
        scheduler: 'Healthy',
        telegram: process.env.TELEGRAM_BOT_TOKEN ? 'Healthy' : 'Not Configured',
        providers: [{ name: providerName, status: 'Healthy', lastScan: settings?.lastScan || 'Never' }],
        lastScan: settings?.lastScan,
      });
    } catch (e: any) {
      res.json({
        server: 'Healthy',
        database: process.env.DATABASE_URL ? 'Error' : 'Not Configured',
        scheduler: 'Healthy',
        telegram: process.env.TELEGRAM_BOT_TOKEN ? 'Healthy' : 'Not Configured',
        providers: [{ name: 'MockRSS', status: 'Healthy', lastScan: 'Never' }],
        lastScan: null,
      });
    }
  });
}
