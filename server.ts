import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { setupRoutes } from './src/api/routes';
import { startScheduler } from './src/scheduler/cron';
import { initTelegramBot } from './src/telegram/bot';
import { initializeSettings } from './src/services/settings';
import dotenv from 'dotenv';
import crypto from 'crypto';
import dns from 'dns';
import { ensureDatabaseSchema } from './src/database/db';

// Ensure IPv4 is preferred for all DNS lookups
dns.setDefaultResultOrder('ipv4first');

dotenv.config();

const INSTANCE_ID = crypto.randomBytes(4).toString('hex');
console.log(`Starting Application Instance ID: ${INSTANCE_ID}`);

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  app.use(express.json());

  // Immediate health check
  app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));
  
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
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    
    // Non-blocking background service initialization
    (async () => {
      try {
        if (process.env.DATABASE_URL) {
          console.log('Connecting to PostgreSQL database...');
          await ensureDatabaseSchema();
          import('./src/services/logger').then(({ logSuccess, logInfo }) => {
            logSuccess('Database connected successfully', 'Database');
            logInfo(`Application Instance ID: ${INSTANCE_ID}`, 'System');
          }).catch(() => {});
          await initializeSettings(INSTANCE_ID);
          startScheduler();
          initTelegramBot();
        } else {
          console.warn('DATABASE_URL not set yet. Configure it via UI Settings.');
        }
      } catch (error: any) {
        console.warn('Non-fatal: Database initialization postponed until valid connection is saved:', error?.message || error);
      }
    })();
  });
}

startServer();

