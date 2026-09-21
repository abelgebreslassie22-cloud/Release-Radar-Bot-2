import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import dotenv from 'dotenv';
import dns from 'dns';

// Fix Node 17+ ENETUNREACH issues by preferring IPv4 for database connections
dns.setDefaultResultOrder('ipv4first');

dotenv.config();

function createPool(connectionString?: string) {
  if (!connectionString) {
    const p = new Pool();
    p.on('error', (err) => console.error('Unexpected PG pool error:', err.message));
    return p;
  }
  const isSslNeeded = connectionString.includes('sslmode=require') || 
                      connectionString.includes('neon.tech') || 
                      connectionString.includes('render.com') || 
                      connectionString.includes('supabase.co');
  const newPool = new Pool({
    connectionString,
    ssl: isSslNeeded ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 10000,
  });
  
  // MUST have an error listener, otherwise unhandled pool errors will crash the Node process
  newPool.on('error', (err) => {
    console.error('Unexpected PostgreSQL Pool Error:', err.message);
  });
  
  return newPool;
}

export let pool: Pool = createPool(process.env.DATABASE_URL);
let _db = drizzle(pool, { schema });

// Proxy to allow dynamic database instance replacement without broken references
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    return (_db as any)[prop];
  }
});

export async function reconnectDatabase(newUrl: string): Promise<{ success: boolean; error?: string }> {
  if (!newUrl || !newUrl.trim()) {
    return { success: false, error: 'Database URL cannot be empty' };
  }
  const cleanUrl = newUrl.trim();
  const testPool = createPool(cleanUrl);
  
  try {
    // Implement an aggressive timeout promise to prevent hanging connection requests
    const clientPromise = testPool.connect();
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timed out after 8 seconds')), 8000));
    
    const client = await Promise.race([clientPromise, timeoutPromise]) as any;
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
  } catch (err: any) {
    try { await testPool.end(); } catch (e) {}
    return { success: false, error: `Connection failed: ${err.message}` };
  }

  // Swap out the active pool and drizzle instance
  try {
    await pool.end();
  } catch (e) {}

  pool = testPool;
  _db = drizzle(pool, { schema });
  process.env.DATABASE_URL = cleanUrl;

  await ensureDatabaseSchema();
  return { success: true };
}

export async function ensureDatabaseSchema() {
  if (!process.env.DATABASE_URL) return;
  try {
    // Ensure all tables exist automatically on fresh databases
    await pool.query(`
      CREATE TABLE IF NOT EXISTS watchlist (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        year INTEGER NOT NULL,
        type TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS watchlist_title_year_type_idx ON watchlist (title, year, type);

      CREATE TABLE IF NOT EXISTS releases (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        year INTEGER NOT NULL,
        type TEXT NOT NULL,
        provider TEXT NOT NULL,
        source_url TEXT NOT NULL,
        release_type TEXT NOT NULL,
        seeders INTEGER DEFAULT 0,
        leechers INTEGER DEFAULT 0,
        poster TEXT,
        metadata_json JSONB,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE INDEX IF NOT EXISTS releases_title_year_idx ON releases (title, year);
      CREATE UNIQUE INDEX IF NOT EXISTS releases_source_url_idx ON releases (source_url);

      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        scan_interval INTEGER DEFAULT 10 NOT NULL,
        telegram_chat_id TEXT,
        metadata_api_key TEXT,
        debug_mode INTEGER DEFAULT 0 NOT NULL,
        provider_type TEXT DEFAULT 'RSS' NOT NULL,
        provider_url TEXT,
        app_url TEXT,
        last_scan TIMESTAMP,
        active_instance_id TEXT
      );

      CREATE TABLE IF NOT EXISTS logs (
        id SERIAL PRIMARY KEY,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        service TEXT NOT NULL,
        details JSONB,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      -- Add columns if missing for existing databases
      ALTER TABLE releases ADD COLUMN IF NOT EXISTS seeders INTEGER DEFAULT 0;
      ALTER TABLE releases ADD COLUMN IF NOT EXISTS leechers INTEGER DEFAULT 0;
      ALTER TABLE settings ADD COLUMN IF NOT EXISTS app_url TEXT;
      ALTER TABLE settings ADD COLUMN IF NOT EXISTS provider_type TEXT DEFAULT 'RSS';
    `);
    console.log('Database schema verified (all tables and columns ensured).');
  } catch (err) {
    console.error('Error ensuring database schema:', err);
  }
}


