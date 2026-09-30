import axios from 'axios';
import { Provider, ReleaseItem } from '../types';
import { logInfo, logWarning, logSuccess } from '../services/logger';
import { normalizeMediaTitle } from '../utils/mediaGrouper';
import { detectSeasonPack, extractEpisodeOrPack, type SeasonPackInfo } from '../utils/seasonPack';

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
  episodeCode?: string; // e.g. S01E06 or "Season 1 Complete Pack"
  isSeasonPack?: boolean;
  packLabel?: string;
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

export { detectSeasonPack, extractEpisodeOrPack, type SeasonPackInfo } from '../utils/seasonPack';

function createMagnet(infoHash: string, name: string): string {
  const trackers = [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.stealth.si:80/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://explodie.org:6969/announce',
    'udp://tracker.moeking.me:6969/announce',
    'udp://p4p.arenabg.com:1337/announce'
  ];
  const trParams = trackers.map(t => `&tr=${encodeURIComponent(t)}`).join('');
  return `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}${trParams}`;
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

export class DownloadRadarProvider implements Provider {
  name = 'Download Availability Radar';

  async initialize() {
    await logInfo('Download Availability Radar initialized (Multi-Source Scene & Web Indexers).', 'DownloadRadar');
  }

  // Multi-source indexer engine: aggregates EZTV (TV shows), Torrents-csv (open database), Apibay (TPB scene), and YTS (movies)
  async findDownloadsForTitle(title: string, year: number, type: string): Promise<DownloadMatch[]> {
    const isTV = type?.toLowerCase() === 'series' || type?.toLowerCase() === 'anime';
    const cleanTitle = title.replace(/[:_.,/\\!?'"@#$%^&*+=\-[\](){}]/g, ' ').replace(/\s+/g, ' ').trim();
    const results: DownloadMatch[] = [];
    const seenHashes = new Set<string>();

    const addMatch = (m: DownloadMatch) => {
      const hashKey = m.infoHash?.toLowerCase();
      if (hashKey && seenHashes.has(hashKey)) return;
      if (hashKey) seenHashes.add(hashKey);
      results.push(m);
    };

    // 1. Torrents-CSV (Open, fast, unblocked on Render)
    const fetchTorrentsCsv = async () => {
      try {
        const url = `https://torrents-csv.com/service/search?q=${encodeURIComponent(cleanTitle)}&size=30`;
        const res = await axios.get(url, { timeout: 5000, headers: BROWSER_HEADERS });
        const items = res.data?.torrents || [];
        const normQuery = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

        for (const item of items) {
          if (!item.name || !item.infohash) continue;
          const name = item.name;
          const normName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!normName.includes(normQuery)) continue;

          if (!isTV && year) {
            const ym = name.match(/\b(19\d\d|20\d\d)\b/);
            if (ym && Math.abs(parseInt(ym[1], 10) - year) > 1) continue;
          }

          const sizeBytes = item.size_bytes || 0;
          if (sizeBytes < 120 * 1024 * 1024) continue; // skip tiny fake files

          const quality = extractQuality(name);
          const episodeCode = extractEpisodeOrPack(name);
          const magnetUrl = createMagnet(item.infohash, name);

          addMatch({
            title,
            name,
            quality,
            sizeText: formatBytes(sizeBytes),
            sizeBytes,
            seeders: item.seeders || 0,
            leechers: item.leechers || 0,
            infoHash: item.infohash,
            magnetUrl,
            sourceUrl: magnetUrl,
            uploadedAt: item.created_unix ? new Date(item.created_unix * 1000) : undefined,
            episodeCode
          });
        }
      } catch (e: any) {
        // Fallback continues
      }
    };

    // 2. EZTV API (Multi-mirror for TV shows with high cloud reliability)
    const fetchEZTV = async () => {
      if (!isTV) return;
      const eztvMirrors = [
        'https://eztvx.to/api/get-torrents?limit=50&page=1',
        'https://eztv.re/api/get-torrents?limit=50&page=1',
        'https://eztv.wf/api/get-torrents?limit=50&page=1'
      ];

      for (const mirrorUrl of eztvMirrors) {
        try {
          const res = await axios.get(mirrorUrl, { timeout: 4000, headers: BROWSER_HEADERS });
          const items = res.data?.torrents || [];
          if (!Array.isArray(items) || items.length === 0) continue;

          const normQuery = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
          let foundCount = 0;

          for (const item of items) {
            if (!item.title || !item.magnet_url) continue;
            const name = item.title;
            const normName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!normName.includes(normQuery)) continue;

            const sizeBytes = parseInt(item.size_bytes || '0', 10);
            const quality = extractQuality(name);
            const episodeCode = extractEpisodeOrPack(name) || (item.season && item.episode ? `S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}` : undefined);
            const hashMatch = item.magnet_url.match(/btih:([a-fA-F0-9]{40})/i);
            const infoHash = hashMatch ? hashMatch[1].toLowerCase() : item.hash || '';

            addMatch({
              title,
              name,
              quality,
              sizeText: formatBytes(sizeBytes),
              sizeBytes,
              seeders: parseInt(item.seeds || '0', 10),
              leechers: parseInt(item.peers || '0', 10),
              infoHash,
              magnetUrl: item.magnet_url,
              sourceUrl: item.magnet_url,
              uploadedAt: item.date_released_unix ? new Date(item.date_released_unix * 1000) : undefined,
              episodeCode
            });
            foundCount++;
          }

          if (foundCount > 0) break; // mirror succeeded with results
        } catch (e: any) {
          // Try next mirror
        }
      }
    };

    // 3. Apibay (The Pirate Bay Indexer) with correct category filtering
    const fetchApibay = async () => {
      try {
        // Category 200 = Movies. For TV shows, use cat=0 or omit cat to get TV episodes!
        const catParam = isTV ? '' : '&cat=200';
        const searchUrl = `https://apibay.org/q.php?q=${encodeURIComponent(cleanTitle)}${catParam}`;

        const res = await axios.get(searchUrl, {
          timeout: 4500,
          headers: BROWSER_HEADERS
        });

        const rawItems = Array.isArray(res.data) ? res.data : [];
        const normQuery = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

        for (const item of rawItems) {
          if (!item.name || item.name === 'No results returned') continue;
          const name = item.name;
          const normName = name.toLowerCase().replace(/[^a-z0-9]/g, '');

          const isMatch = normName.startsWith(normQuery) || 
            (normName.includes(normQuery) && (new RegExp(`(^|[^a-z0-9])${normQuery}([^a-z0-9]|$)`, 'i')).test(name.toLowerCase().replace(/[^a-z0-9]/g, ' ')));
          if (!isMatch) continue;

          if (!isTV && year) {
            const ym = name.match(/\b(19\d\d|20\d\d)\b/);
            if (ym && Math.abs(parseInt(ym[1], 10) - year) > 1) continue;
          }

          const sizeBytes = parseInt(item.size || '0', 10);
          if (sizeBytes < 120 * 1024 * 1024) continue;

          const quality = extractQuality(name);
          const episodeCode = extractEpisodeOrPack(name);
          const magnetUrl = createMagnet(item.info_hash, name);

          addMatch({
            title,
            name,
            quality,
            sizeText: formatBytes(sizeBytes),
            sizeBytes,
            seeders: parseInt(item.seeders || '0', 10),
            leechers: parseInt(item.leechers || '0', 10),
            infoHash: item.info_hash,
            magnetUrl,
            sourceUrl: magnetUrl,
            uploadedAt: item.added ? new Date(parseInt(item.added, 10) * 1000) : undefined,
            episodeCode
          });
        }
      } catch (e: any) {
        // Fallback continues
      }
    };

    // 4. YTS Movie API (Multi-mirror for movies with cloud fallback)
    const fetchYTS = async () => {
      if (isTV) return;
      const ytsMirrors = ['https://yts.lt', 'https://yts.am', 'https://yts.bz', 'https://yts.mx'];

      for (const baseMirror of ytsMirrors) {
        try {
          const url = `${baseMirror}/api/v2/list_movies.json?query_term=${encodeURIComponent(cleanTitle)}&limit=10`;
          const res = await axios.get(url, { timeout: 3500, headers: BROWSER_HEADERS });
          const movies = res.data?.data?.movies || [];
          if (!Array.isArray(movies) || movies.length === 0) continue;

          let foundCount = 0;
          for (const m of movies) {
            if (!m.title || !Array.isArray(m.torrents)) continue;
            if (year && Math.abs(m.year - year) > 1) continue;

            for (const t of m.torrents) {
              if (!t.hash) continue;
              const releaseName = `${m.title} (${m.year}) [${t.quality}] [${t.type || 'WEBRip'}] [YTS]`;
              const sizeBytes = t.size_bytes || 0;
              const magnetUrl = createMagnet(t.hash, releaseName);

              addMatch({
                title,
                name: releaseName,
                quality: `${t.quality} ${t.type || 'WEB-DL'}`,
                sizeText: t.size || formatBytes(sizeBytes),
                sizeBytes,
                seeders: t.seeds || 0,
                leechers: t.peers || 0,
                infoHash: t.hash,
                magnetUrl,
                sourceUrl: magnetUrl,
                uploadedAt: t.date_uploaded_unix ? new Date(t.date_uploaded_unix * 1000) : undefined
              });
              foundCount++;
            }
          }

          if (foundCount > 0) break; // mirror succeeded with releases
        } catch (e: any) {
          // Try next mirror
        }
      }
    };

    // Run independent indexers in parallel with fault tolerance
    await Promise.allSettled([
      fetchTorrentsCsv(),
      fetchEZTV(),
      fetchApibay(),
      fetchYTS()
    ]);

    // Sort all aggregated results by seeders descending
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
            const packInfo = detectSeasonPack(rel.name);
            let status = `🟢 Download Available: ${rel.quality} (${rel.sizeText}) • ${rel.seeders} Seeds`;
            if (packInfo.isPack && packInfo.label) {
              status = `📦 ${packInfo.label}: ${rel.quality} (${rel.sizeText}) • ${rel.seeders} Seeds`;
            } else if (isTV && rel.episodeCode) {
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
