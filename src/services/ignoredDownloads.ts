import { db, pool } from '../database/db';
import { ignoredDownloads, releases, discoveredReleases } from '../database/schema';
import { eq, or, inArray } from 'drizzle-orm';
import { extractEpisodeOrPack } from '../providers/downloadRadarProvider';

export function extractMagnetHash(url?: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/btih:([a-fA-F0-9]{32,40}|[a-zA-Z2-7]{32})/i);
  return match ? match[1].toLowerCase() : null;
}

export function normalizeDownloadTitle(title?: string): string {
  if (!title || typeof title !== 'string') return '';
  return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// In-memory cache of ignored signatures to make scanning lightning fast
let cacheLoadedAt = 0;
let cachedHashes = new Set<string>();
let cachedUrls = new Set<string>();
let cachedTitles = new Set<string>();

export async function loadIgnoredCache(force = false): Promise<{
  hashes: Set<string>;
  urls: Set<string>;
  titles: Set<string>;
}> {
  const now = Date.now();
  // Refresh cache every 30 seconds or if forced
  if (!force && cacheLoadedAt > 0 && now - cacheLoadedAt < 30000) {
    return { hashes: cachedHashes, urls: cachedUrls, titles: cachedTitles };
  }

  try {
    const rows = await db.select().from(ignoredDownloads);
    const hashes = new Set<string>();
    const urls = new Set<string>();
    const titles = new Set<string>();

    for (const r of rows) {
      if (r.infoHash) hashes.add(r.infoHash.toLowerCase());
      if (r.sourceUrl) {
        urls.add(r.sourceUrl);
        const h = extractMagnetHash(r.sourceUrl);
        if (h) hashes.add(h);
      }
      if (r.normalizedTitle) titles.add(r.normalizedTitle);
      if (r.title) titles.add(normalizeDownloadTitle(r.title));
    }

    cachedHashes = hashes;
    cachedUrls = urls;
    cachedTitles = titles;
    cacheLoadedAt = now;
    return { hashes, urls, titles };
  } catch (e: any) {
    console.warn('[IgnoredDownloads] Failed to load cache from DB:', e?.message || e);
    return { hashes: cachedHashes, urls: cachedUrls, titles: cachedTitles };
  }
}

/**
 * Checks if a candidate download release has been permanently blacklisted / deleted by the user
 */
export async function isDownloadIgnored(dl: {
  title?: string;
  name?: string;
  sourceUrl?: string;
  magnetUrl?: string;
}): Promise<boolean> {
  const { hashes, urls, titles } = await loadIgnoredCache();

  const url = dl.sourceUrl || dl.magnetUrl;
  if (url) {
    if (urls.has(url)) return true;
    const h = extractMagnetHash(url);
    if (h && hashes.has(h)) return true;
  }

  const rawTitle = dl.title || dl.name;
  if (rawTitle) {
    const norm = normalizeDownloadTitle(rawTitle);
    if (norm && titles.has(norm)) return true;
  }

  return false;
}

/**
 * Filters out blacklisted downloads from a list
 */
export async function filterIgnoredDownloads<T extends { title?: string; name?: string; sourceUrl?: string; magnetUrl?: string }>(
  items: T[]
): Promise<T[]> {
  if (!Array.isArray(items) || items.length === 0) return [];
  const { hashes, urls, titles } = await loadIgnoredCache();

  return items.filter(item => {
    const url = item.sourceUrl || item.magnetUrl;
    if (url) {
      if (urls.has(url)) return false;
      const h = extractMagnetHash(url);
      if (h && hashes.has(h)) return false;
    }

    const rawTitle = item.title || item.name;
    if (rawTitle) {
      const norm = normalizeDownloadTitle(rawTitle);
      if (norm && titles.has(norm)) return false;
    }

    return true;
  });
}

/**
 * Permanently blacklists a deleted download:
 * 1. Inserts into ignored_downloads database table.
 * 2. Purges it from releases (metadataJson.downloads & allReleases).
 * 3. Removes its episode code from notifiedEpisodes so that when the REAL episode drops, the user will be notified!
 * 4. Purges it from discovered_releases.
 */
export async function deleteAndBlacklistDownload(params: {
  id?: number | string;
  title: string;
  sourceUrl?: string;
  seriesTitle?: string;
  groupKey?: string;
  reason?: string;
}): Promise<{ success: boolean; unnotifiedEpisode?: string }> {
  try {
    const { title, sourceUrl, seriesTitle, reason } = params;
    const normTitle = normalizeDownloadTitle(title);
    const infoHash = extractMagnetHash(sourceUrl);

    // 1. Detect episode code (e.g. S01E04, E04)
    let episodeCode = extractEpisodeOrPack(title);
    if (!episodeCode && title) {
      const epMatch = title.match(/\bS(\d{1,2})E(\d{1,2})\b/i) || title.match(/\b(\d{1,2})x(\d{1,2})\b/i);
      if (epMatch) {
        episodeCode = `S${epMatch[1].padStart(2, '0')}E${epMatch[2].padStart(2, '0')}`;
      } else {
        const singleEp = title.match(/\b(?:E|EP|Episode|#)\s*0*(\d{1,3})\b/i);
        if (singleEp) {
          episodeCode = `E${singleEp[1].padStart(2, '0')}`;
        }
      }
    }
    const cleanEpisodeCode = episodeCode ? episodeCode.toUpperCase() : undefined;

    // 2. Insert into ignored_downloads table (avoid duplicates)
    await db.insert(ignoredDownloads).values({
      title: title || 'Deleted Download',
      normalizedTitle: normTitle || undefined,
      sourceUrl: sourceUrl || undefined,
      infoHash: infoHash || undefined,
      episodeCode: cleanEpisodeCode || undefined,
      seriesTitle: seriesTitle || undefined,
      reason: reason || 'user_deleted'
    });

    // Invalidate in-memory cache
    await loadIgnoredCache(true);

    console.log(`[Blacklist] Permanently blacklisted download: "${title}" (hash: ${infoHash || 'none'}, ep: ${cleanEpisodeCode || 'none'})`);

    // 3. Purge from releases table and un-notify the episode code
    const allReleases = await db.select().from(releases);

    for (const card of allReleases) {
      const meta = (card.metadataJson as any) || {};
      const dls = Array.isArray(meta.downloads) ? meta.downloads : [];
      const allRels = Array.isArray(meta.allReleases) ? meta.allReleases : [];

      const isMatch = (item: any) => {
        if (!item) return false;
        if (params.id && String(item.id) === String(params.id)) return true;
        if (sourceUrl && (item.sourceUrl === sourceUrl || item.magnetUrl === sourceUrl)) return true;
        if (infoHash) {
          const itemHash = extractMagnetHash(item.sourceUrl || item.magnetUrl);
          if (itemHash && itemHash === infoHash) return true;
        }
        if (title && item.title && item.title.trim().toLowerCase() === title.trim().toLowerCase()) return true;
        if (normTitle && normalizeDownloadTitle(item.title) === normTitle) return true;
        return false;
      };

      const filteredDls = dls.filter((d: any) => !isMatch(d));
      const filteredAllRels = allRels.filter((r: any) => !isMatch(r));

      let updatedMeta = { ...meta };
      let hasChanges = false;

      if (filteredDls.length !== dls.length || filteredAllRels.length !== allRels.length) {
        hasChanges = true;
        updatedMeta.downloads = filteredDls;
        if (allRels.length > 0) {
          updatedMeta.allReleases = filteredAllRels;
        }
      }

      // CRITICAL: Un-notify this episode from notifiedEpisodes so user CAN be notified when the real episode drops!
      if (cleanEpisodeCode && Array.isArray(meta.notifiedEpisodes)) {
        const existingNotifs: string[] = meta.notifiedEpisodes.map((e: string) => e.toUpperCase());
        if (existingNotifs.includes(cleanEpisodeCode)) {
          hasChanges = true;
          updatedMeta.notifiedEpisodes = existingNotifs.filter(e => e !== cleanEpisodeCode);
          console.log(`[Blacklist] Removed ${cleanEpisodeCode} from notifiedEpisodes of "${card.title}" so real episode can notify later.`);
        }
      }

      // If latestEpisode was this deleted episode, clear the flag
      if (cleanEpisodeCode && updatedMeta.latestEpisode === cleanEpisodeCode) {
        hasChanges = true;
        delete updatedMeta.latestEpisode;
        delete updatedMeta.hasNewEpisodeToday;
      }

      if (hasChanges) {
        const topSeeds = filteredDls.reduce((max: number, d: any) => Math.max(max, d.seeders || 0), 0);
        const bestSummary = filteredDls.length > 0
          ? `🟢 Download Available: ${filteredDls.length} Qualities • ${topSeeds} Seeds`
          : '🟡 Monitored (Searching for releases...)';

        await db.update(releases).set({
          metadataJson: updatedMeta,
          releaseType: bestSummary,
          seeders: topSeeds,
          sourceUrl: filteredDls[0]?.sourceUrl || filteredDls[0]?.magnetUrl || card.sourceUrl,
          updatedAt: new Date()
        }).where(eq(releases.id, card.id));
      }
    }

    // 4. Purge from discovered_releases table as well
    const allDiscovered = await db.select().from(discoveredReleases);
    for (const disc of allDiscovered) {
      const dls = Array.isArray(disc.downloads) ? disc.downloads : [];
      const isMatch = (item: any) => {
        if (!item) return false;
        if (params.id && String(item.id) === String(params.id)) return true;
        if (sourceUrl && (item.sourceUrl === sourceUrl || item.magnetUrl === sourceUrl)) return true;
        if (infoHash) {
          const itemHash = extractMagnetHash(item.sourceUrl || item.magnetUrl);
          if (itemHash && itemHash === infoHash) return true;
        }
        if (title && item.title && item.title.trim().toLowerCase() === title.trim().toLowerCase()) return true;
        if (normTitle && normalizeDownloadTitle(item.title) === normTitle) return true;
        return false;
      };

      const filteredDls = dls.filter((d: any) => !isMatch(d));
      if (filteredDls.length !== dls.length) {
        const topSeeds = filteredDls.reduce((max: number, d: any) => Math.max(max, d.seeders || 0), 0);
        await db.update(discoveredReleases).set({
          downloads: filteredDls,
          topSeeds,
          updatedAt: new Date()
        }).where(eq(discoveredReleases.id, disc.id));
      }
    }

    return { success: true, unnotifiedEpisode: cleanEpisodeCode };
  } catch (err: any) {
    console.error('Error in deleteAndBlacklistDownload:', err);
    return { success: false };
  }
}
