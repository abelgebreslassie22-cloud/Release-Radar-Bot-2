import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import dotenv from 'dotenv';
import dns from 'dns';
import { extractEpisodeOrPack } from '../providers/downloadRadarProvider';

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

export async function consolidateReleasesDatabase() {
  if (!process.env.DATABASE_URL) return;
  try {
    const wlRes = await pool.query('SELECT * FROM watchlist ORDER BY LENGTH(title) DESC');
    const relRes = await pool.query('SELECT * FROM releases ORDER BY id ASC');

    if (relRes.rows.length === 0) return;

    // Check if multiple release rows exist or if consolidation is needed
    const hasRawSceneTitles = relRes.rows.some((r: any) => 
      r.title.includes('1080p') || r.title.includes('720p') || r.title.includes('2160p') || 
      r.title.includes('WEBRip') || r.title.includes('BluRay') || r.title.includes('HEVC')
    );

    if (!hasRawSceneTitles && relRes.rows.length <= wlRes.rows.length) {
      return;
    }

    console.log(`[Database Migration] Consolidating ${relRes.rows.length} releases into 1 card per movie/show...`);

    const wlItems = wlRes.rows;
    const matches = new Map<number, { wl: any; releases: any[] }>();

    for (const w of wlItems) {
      matches.set(w.id, { wl: w, releases: [] });
    }

    for (const r of relRes.rows) {
      const rClean = (r.title || '').replace(/[._]/g, ' ').toLowerCase().replace(/[^a-z0-9]/g, '');
      let matchedWl: any = null;

      for (const w of wlItems) {
        const wClean = (w.title || '').replace(/[._]/g, ' ').toLowerCase().replace(/[^a-z0-9]/g, '');
        const isPartTwo = rClean.includes('parttwo') || rClean.includes('part2') || rClean.includes('partii');

        if (w.title.toLowerCase().includes('part two') || w.title.toLowerCase().includes('part 2')) {
          if (isPartTwo) {
            matchedWl = w;
            break;
          }
        } else if (w.title.toLowerCase() === 'dune') {
          if (!isPartTwo && (rClean.includes('dune') && !rClean.includes('prophecy'))) {
            matchedWl = w;
            break;
          }
        } else {
          if (rClean === wClean || rClean.startsWith(wClean) || rClean.includes(wClean)) {
            matchedWl = w;
            break;
          }
        }
      }

      if (matchedWl) {
        matches.get(matchedWl.id)!.releases.push(r);
      }
    }

    // Delete existing fragmented rows
    await pool.query('DELETE FROM releases');

    // Reinsert clean, consolidated single card for each watchlist movie/show
    for (const [_, data] of matches.entries()) {
      const w = data.wl;
      const rels = data.releases;

      const downloads: any[] = [];
      let bestPoster: string | null = null;
      let bestMetadata: any = null;
      let topSeeds = 0;
      let totalLeeches = 0;
      let bestSourceUrl = '';
      let bestQualitySummary = '🟡 Monitored (Searching for releases...)';

      for (const r of rels) {
        if (!bestPoster && r.poster) bestPoster = r.poster;
        if (!bestMetadata && r.metadata_json) bestMetadata = r.metadata_json;
        if (r.seeders > topSeeds) {
          topSeeds = r.seeders;
          if (r.source_url) bestSourceUrl = r.source_url;
        }
        totalLeeches += (r.leechers || 0);

        if (Array.isArray(r.metadata_json?.downloads) && r.metadata_json.downloads.length > 0) {
          for (const d of r.metadata_json.downloads) {
            if (!downloads.some(x => x.sourceUrl === d.sourceUrl)) {
              downloads.push(d);
            }
          }
        } else if (r.source_url && (r.source_url.startsWith('magnet:') || r.release_type?.includes('Download Available'))) {
          if (!downloads.some(x => x.sourceUrl === r.source_url)) {
            downloads.push({
              id: r.id,
              title: r.title,
              releaseType: r.release_type,
              sourceUrl: r.source_url,
              seeders: r.seeders || 0,
              leechers: r.leechers || 0,
              createdAt: r.created_at || new Date().toISOString()
            });
          }
        }
      }

      if (downloads.length > 0) {
        bestQualitySummary = `🟢 Download Available: ${downloads.length} Qualities • ${topSeeds} Seeds`;
        if (!bestSourceUrl) bestSourceUrl = downloads[0].sourceUrl;
      }

      if (!bestSourceUrl) {
        bestSourceUrl = `https://www.themoviedb.org/search?query=${encodeURIComponent(w.title)}`;
      }

      await pool.query(`
        INSERT INTO releases (title, year, type, provider, source_url, release_type, seeders, leechers, poster, metadata_json, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      `, [
        w.title,
        w.year,
        w.type,
        downloads.length > 0 ? 'Download Availability Radar' : 'Radar Monitor',
        bestSourceUrl,
        bestQualitySummary,
        topSeeds,
        totalLeeches,
        bestPoster,
        JSON.stringify({ ...(bestMetadata || {}), downloads })
      ]);
    }

    // Now that releases are clean with 1 card per movie/show, enforce the unique constraint
    await pool.query(`
      DROP INDEX IF EXISTS releases_source_url_idx;
      CREATE UNIQUE INDEX IF NOT EXISTS releases_title_year_type_idx ON releases (title, year, type);
    `);

    console.log('[Database Migration] Complete: Each movie and TV show now has exactly 1 card.');
  } catch (e: any) {
    console.error('Error during releases database consolidation:', e);
  }
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
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE INDEX IF NOT EXISTS releases_title_year_idx ON releases (title, year);

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
      ALTER TABLE releases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
      ALTER TABLE settings ADD COLUMN IF NOT EXISTS app_url TEXT;
      ALTER TABLE settings ADD COLUMN IF NOT EXISTS provider_type TEXT DEFAULT 'RSS';
    `);

    // Consolidate fragmented releases into 1 card per movie/show
    await consolidateReleasesDatabase();

    // Drop old source_url constraint and enforce 1 card per movie/year/type
    await pool.query(`
      DROP INDEX IF EXISTS releases_source_url_idx;
      CREATE UNIQUE INDEX IF NOT EXISTS releases_title_year_type_idx ON releases (title, year, type);
    `);

    // Ensure all existing releases have initialSyncCompleted: true and notifiedEpisodes initialized
    const existingRows = await pool.query('SELECT id, title, type, metadata_json FROM releases');
    for (const row of existingRows.rows) {
      const meta = row.metadata_json || {};
      if (!meta.initialSyncCompleted || !meta.notifiedEpisodes) {
        const dls = Array.isArray(meta.downloads) ? meta.downloads : [];
        const eps = new Set<string>();
        for (const d of dls) {
          const ep = extractEpisodeOrPack(d.title) || extractEpisodeOrPack(d.releaseType);
          if (ep) eps.add(ep.toUpperCase());
        }
        meta.initialSyncCompleted = true;
        meta.notifiedEpisodes = Array.from(eps);
        meta.notifiedMovie = (row.type?.toLowerCase() !== 'series' && dls.length > 0);
        await pool.query('UPDATE releases SET metadata_json = $1 WHERE id = $2', [JSON.stringify(meta), row.id]);
      }
    }

    console.log('Database schema verified (all tables and columns ensured, 1 card per movie enforced, initial sync initialized).');
  } catch (err) {
    console.error('Error ensuring database schema:', err);
  }
}


