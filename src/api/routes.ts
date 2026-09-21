import { Express, Request, Response } from 'express';
import { db } from '../database/db';
import { watchlist, releases } from '../database/schema';
import { getSettings, updateSettings } from '../services/settings';
import { restartScheduler } from '../scheduler/cron';
import { eq, desc, count, inArray } from 'drizzle-orm';

export function setupRoutes(app: Express) {
  // Health check for Render
  app.get('/health', (req: Request, res: Response) => {
    res.status(200).send('OK');
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

      await db.delete(watchlist).where(eq(watchlist.id, id));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message || 'Failed to delete item' }); }
  });

  // Releases
  app.get('/api/releases', async (req: Request, res: Response) => {
    try {
      const items = await db.select().from(releases).orderBy(desc(releases.createdAt));
      res.json(items);
    } catch (e: any) { res.json([]); }
  });

  app.delete('/api/releases/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid release ID' });
      await db.delete(releases).where(eq(releases.id, id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Failed to delete release' });
    }
  });

  app.post('/api/releases/delete-batch', async (req: Request, res: Response) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Array of release IDs is required' });
      }
      const numIds = ids.map(id => Number(id)).filter(id => !isNaN(id));
      if (numIds.length === 0) {
        return res.status(400).json({ error: 'No valid release IDs provided' });
      }
      await db.delete(releases).where(inArray(releases.id, numIds));
      res.json({ success: true });
    } catch (e: any) {
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

      res.json({
        hasDatabaseUrl: !!process.env.DATABASE_URL,
        databaseUrlMasked: mask(process.env.DATABASE_URL),
        isDbConnected,
        dbError,
        hasTelegramToken: !!process.env.TELEGRAM_BOT_TOKEN,
        telegramTokenMasked: mask(process.env.TELEGRAM_BOT_TOKEN),
        telegramChatId: settings?.telegramChatId || '',
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

      // 3. Update Database Settings (ChatId, Metadata Key, AppUrl, Interval, Provider)
      try {
        const updatePayload: any = {};
        if (telegramChatId !== undefined) updatePayload.telegramChatId = telegramChatId;
        if (metadataApiKey !== undefined) updatePayload.metadataApiKey = metadataApiKey;
        if (appUrl !== undefined) updatePayload.appUrl = appUrl;
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
