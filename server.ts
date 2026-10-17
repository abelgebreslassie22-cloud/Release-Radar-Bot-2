import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { setupRoutes } from './src/api/routes';
import { initializeSettings } from './src/services/settings';
import { supervisor } from './src/services/keepalive';
import dotenv from 'dotenv';
import crypto from 'crypto';
import dns from 'dns';
import { ensureDatabaseSchema } from './src/database/db';

// Ensure IPv4 is preferred for all DNS lookups
dns.setDefaultResultOrder('ipv4first');

dotenv.config();

const INSTANCE_ID = crypto.randomBytes(4).toString('hex');
console.log(`Starting Application Instance ID: ${INSTANCE_ID}`);

// Handle uncaught exceptions gracefully to prevent container restart
process.on('uncaughtException', (err) => {
  console.error('[Process UncaughtException]', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Process UnhandledRejection]', reason);
});

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  // Trust proxy for Google Cloud Run & Render so req.headers['x-forwarded-*'] are parsed
  app.set('trust proxy', true);

  app.use(express.json());

  // Setup all API routes & health endpoints
  setupRoutes(app);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Release Radar listening on http://0.0.0.0:${PORT}`);
    
    // Autonomous Multi-Tier Background Supervisor Initialization
    (async () => {
      try {
        if (process.env.DATABASE_URL) {
          console.log('[Database] Connecting to PostgreSQL database...');
          await ensureDatabaseSchema();
          import('./src/services/logger').then(({ logSuccess, logInfo }) => {
            logSuccess('Database connected successfully', 'Database');
            logInfo(`Application Instance ID: ${INSTANCE_ID}`, 'System');
          }).catch(() => {});
          await initializeSettings(INSTANCE_ID);
        } else {
          console.warn('[Database] DATABASE_URL not set yet. Running in bootstrap mode.');
        }

        // Start 24/7 Supervisor, Bot, Cron Scheduler, Ingress Loop, and Watchdog
        await supervisor.startSupervisor();
      } catch (error: any) {
        console.warn('Non-fatal: Background initialization handled:', error?.message || error);
        // Even if database has a temporary issue, keep supervisor active
        await supervisor.startSupervisor().catch(() => {});
      }
    })();
  });
}

startServer();
