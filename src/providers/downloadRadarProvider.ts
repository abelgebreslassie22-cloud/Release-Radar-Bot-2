import axios from 'axios';
import { Provider, ReleaseItem } from '../types';
import { logInfo, logWarning, logSuccess } from '../services/logger';
import { normalizeMediaTitle } from '../utils/mediaGrouper';

export interface DownloadMatch {
  title: string;
  name: string;
  quality: string;
  sizeText: string;
  sizeBytes: number;
  seeders: number;
  leechers: number;
  infoHash: string;
  magnetUrl: string;
  sourceUrl: string;
  uploadedAt?: Date;
  episodeCode?: string; // e.g. S01E09
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

function extractQuality(name: string): string {
  if (/2160p|4k|uhd/i.test(name)) return '4K UHD';
  if (/1080p.*(bluray|bdrip|remux)/i.test(name)) return '1080p BluRay';
  if (/1080p/i.test(name)) return '1080p WEB-DL';
  if (/720p/i.test(name)) return '720p HD';
  if (/bluray|bdrip/i.test(name)) return 'BluRay';
  if (/web-?dl|webrip/i.test(name)) return 'WEB-DL';
  return 'HD';
}

function createMagnet(infoHash: string, name: string): string {
  const trackers = [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.stealth.si:80/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://explodie.org:6969/announce'
  ];
  const trParams = trackers.map(t => `&tr=${encodeURIComponent(t)}`).join('');
  return `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}${trParams}`;
}

export class DownloadRadarProvider implements Provider {
  name = 'Download Availability Radar';

  async initialize() {
    await logInfo('Download Availability Radar initialized (Scene & Web Release Indexers).', 'DownloadRadar');
  }

  async findDownloadsForTitle(title: string, year: number, type: string): Promise<DownloadMatch[]> {
    const isTV = type?.toLowerCase() === 'series' || type?.toLowerCase() === 'anime';
    const cleanTitle = normalizeMediaTitle(title);
    const results: DownloadMatch[] = [];

    // 1. Search Apibay (The Pirate Bay / Scene Releases API)
    try {
      const category = isTV ? '205,208' : '201,207'; // 201=Movies, 207=HD Movies, 205=TV, 208=HD TV
      const searchUrl = `https://apibay.org/q.php?q=${encodeURIComponent(cleanTitle)}&cat=${category}`;
      
      const res = await axios.get(searchUrl, {
        timeout: 6000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });

      const rawItems = Array.isArray(res.data) ? res.data : [];
      const normQuery = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

      for (const item of rawItems) {
        if (!item.name || item.name === 'No results returned') continue;
        const name = item.name;
        const normName = name.toLowerCase().replace(/[^a-z0-9]/g, '');

        // Verify title match
        if (!normName.includes(normQuery)) continue;

        // If movie, check year match if year is available
        if (!isTV && year) {
          const yearMatch = name.match(/\b(19\d\d|20\d\d)\b/);
          if (yearMatch) {
            const relYear = parseInt(yearMatch[1], 10);
            if (Math.abs(relYear - year) > 1) continue; // skip wrong movie year
          }
        }

        const sizeBytes = parseInt(item.size || '0', 10);
        // Skip tiny fake files (< 150MB for video)
        if (sizeBytes < 150 * 1024 * 1024) continue;

        const seeders = parseInt(item.seeders || '0', 10);
        const leechers = parseInt(item.leechers || '0', 10);
        const quality = extractQuality(name);
        const sizeText = formatBytes(sizeBytes);
        const magnetUrl = createMagnet(item.info_hash, name);

        // Check for episode code in TV show (e.g. S01E09)
        let episodeCode: string | undefined;
        const epMatch = name.match(/\bS(\d{1,2})E(\d{1,2})\b/i);
        if (epMatch) {
          episodeCode = `S${epMatch[1].padStart(2, '0')}E${epMatch[2].padStart(2, '0')}`;
        }

        results.push({
          title,
          name,
          quality,
          sizeText,
          sizeBytes,
          seeders,
          leechers,
          infoHash: item.info_hash,
          magnetUrl,
          sourceUrl: magnetUrl,
          uploadedAt: item.added ? new Date(parseInt(item.added, 10) * 1000) : undefined,
          episodeCode,
        });
      }
    } catch (e: any) {
      // Non-fatal fallback
    }

    // Sort by seeders descending to pick the best/healthiest downloadable release
    results.sort((a, b) => b.seeders - a.seeders);
    return results;
  }

  async scan(watchlistItems?: { title: string; year: number; type: string }[]): Promise<ReleaseItem[]> {
    if (!watchlistItems || watchlistItems.length === 0) return [];
    const items: ReleaseItem[] = [];

    for (const wl of watchlistItems) {
      try {
        const matches = await this.findDownloadsForTitle(wl.title, wl.year, wl.type);
        if (matches.length > 0) {
          const best = matches[0];
          const isTV = wl.type?.toLowerCase() === 'series' || wl.type?.toLowerCase() === 'anime';
          
          let status = `🟢 Download Available: ${best.quality} (${best.sizeText}) • ${best.seeders} Seeds`;
          if (isTV && best.episodeCode) {
            status = `🟢 Download Available: ${best.episodeCode} ${best.quality} (${best.sizeText}) • ${best.seeders} Seeds`;
          }

          items.push({
            title: wl.title,
            year: wl.year,
            type: wl.type,
            releaseType: status,
            sourceUrl: best.magnetUrl,
            provider: 'Download Availability Radar',
            seeders: best.seeders,
            leechers: best.leechers,
          });
        }
      } catch (err: any) {
        await logWarning(`Error checking downloads for "${wl.title}": ${err.message}`, 'DownloadRadar');
      }
    }

    return items;
  }
}
