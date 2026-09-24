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
  episodeCode?: string; // e.g. S01E06
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

export function extractQuality(name: string): string {
  const isRemux = /remux/i.test(name);
  const isHDR = /hdr10\+|hdr10|hdr|dolby|dv\b|dovi|vision/i.test(name);
  const isH265 = /x265|hevc|10bit/i.test(name);
  const isBluray = /bluray|bdrip|brrip/i.test(name);
  const isWeb = /web-?dl|webrip|web\b|amzn|atvp|hmax|nf|disney|apple/i.test(name);

  if (/2160p|4k|uhd/i.test(name)) {
    if (isRemux) return '2160p 4K Remux';
    if (isHDR) return '2160p 4K HDR';
    return '2160p 4K UHD';
  }
  if (/1080p/i.test(name)) {
    if (isRemux) return '1080p Remux';
    if (isBluray) {
      return isH265 ? '1080p BluRay x265' : '1080p BluRay';
    }
    if (isH265) return '1080p WEB x265';
    if (isWeb) return '1080p WEB-DL';
    return '1080p HD';
  }
  if (/720p/i.test(name)) {
    if (isWeb) return '720p WEB-DL';
    return '720p HD';
  }
  if (/480p|dvdrip|xvid|sd\b/i.test(name)) {
    return '480p SD';
  }
  if (isBluray) return 'BluRay';
  if (isWeb) return 'WEB-DL';
  return 'HD';
}

export function extractEpisodeOrPack(name: string): string | undefined {
  const epMatch = name.match(/\bS(\d{1,2})E(\d{1,2})\b/i);
  if (epMatch) {
    return `S${epMatch[1].padStart(2, '0')}E${epMatch[2].padStart(2, '0')}`;
  }
  const packMatch = name.match(/\bS(\d{1,2})\b(?!\s*E\d)/i) || name.match(/\bSeason\s*(\d{1,2})\b/i);
  if (packMatch) {
    return `Season ${parseInt(packMatch[1], 10)} Pack`;
  }
  return undefined;
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

    // Search Apibay (The Pirate Bay / Scene Releases API)
    try {
      const searchUrl = `https://apibay.org/q.php?q=${encodeURIComponent(cleanTitle)}&cat=200`;
      
      const res = await axios.get(searchUrl, {
        timeout: 7000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });

      const rawItems = Array.isArray(res.data) ? res.data : [];
      const normQuery = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

      for (const item of rawItems) {
        if (!item.name || item.name === 'No results returned') continue;
        const name = item.name;
        const normName = name.toLowerCase().replace(/[^a-z0-9]/g, '');

        // Verify title match (exact prefix or boundary check)
        const isMatch = normName.startsWith(normQuery) || 
          normName.includes(normQuery) && (new RegExp(`(^|[^a-z0-9])${normQuery}([^a-z0-9]|$)`, 'i')).test(name.toLowerCase().replace(/[^a-z0-9]/g, ' '));
        if (!isMatch) continue;

        // If movie, check year match if year is specified
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
        const episodeCode = extractEpisodeOrPack(name);

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

    // Sort by seeders descending
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
          const isTV = wl.type?.toLowerCase() === 'series' || wl.type?.toLowerCase() === 'anime';
          
          // Group by (Episode/Pack + Quality) to capture every distinct quality release
          const qualityMap = new Map<string, DownloadMatch>();

          for (const match of matches) {
            const groupKey = isTV ? (match.episodeCode || 'General') : 'Movie';
            const tierKey = `${groupKey}__${match.quality}`;
            
            // For each episode & quality tier, keep the healthiest release
            if (!qualityMap.has(tierKey) || match.seeders > qualityMap.get(tierKey)!.seeders) {
              qualityMap.set(tierKey, match);
            }
          }

          // Also keep any high-health release with 100+ seeds even if in the same tier (up to top 25 per show)
          const selected = Array.from(qualityMap.values())
            .sort((a, b) => {
              if (isTV && a.episodeCode && b.episodeCode && a.episodeCode !== b.episodeCode) {
                return b.episodeCode.localeCompare(a.episodeCode); // Latest episodes first
              }
              return b.seeders - a.seeders;
            })
            .slice(0, 25);

          for (const rel of selected) {
            let status = `🟢 Download Available: ${rel.quality} (${rel.sizeText}) • ${rel.seeders} Seeds`;
            if (isTV && rel.episodeCode) {
              status = `🟢 Download Available: ${rel.episodeCode} ${rel.quality} (${rel.sizeText}) • ${rel.seeders} Seeds`;
            }

            items.push({
              title: rel.name, // Full scene release name so users see exact codec/quality/group
              year: wl.year,
              type: wl.type,
              releaseType: status,
              sourceUrl: rel.magnetUrl,
              provider: 'Download Availability Radar',
              seeders: rel.seeders,
              leechers: rel.leechers,
            });
          }
        }
      } catch (err: any) {
        await logWarning(`Error checking downloads for "${wl.title}": ${err.message}`, 'DownloadRadar');
      }
    }

    return items;
  }
}
