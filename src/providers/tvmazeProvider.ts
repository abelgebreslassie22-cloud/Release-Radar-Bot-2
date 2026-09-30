import axios from 'axios';
import { Provider, ReleaseItem } from '../types';
import { logInfo, logWarning, logSuccess } from '../services/logger';

export interface TVMazeEpisode {
  id: number;
  name: string;
  season: number;
  number: number;
  airdate: string;
  airtime: string;
  runtime: number;
  summary?: string;
  image?: { medium: string; original: string };
}

export interface TVMazeShow {
  id: number;
  name: string;
  type: string;
  status: string;
  premiered?: string;
  network?: { name: string };
  webChannel?: { name: string };
  image?: { medium: string; original: string };
  _embedded?: {
    episodes?: TVMazeEpisode[];
  };
}

export class TVMazeProvider implements Provider {
  name = 'TVMaze Streaming & Broadcast Radar';

  async initialize() {
    await logInfo('TVMaze Live TV & Streaming Premiere Radar initialized (0% Cloud Block Rate).', 'TVMazeRadar');
  }

  async scan(watchlistItems?: { title: string; year: number; type: string }[]): Promise<ReleaseItem[]> {
    if (!watchlistItems || watchlistItems.length === 0) return [];
    const items: ReleaseItem[] = [];
    const today = new Date().toISOString().split('T')[0];
    const nowMs = Date.now();

    for (const wl of watchlistItems) {
      const isTV = wl.type?.toLowerCase() === 'series' || wl.type?.toLowerCase() === 'anime';
      if (!isTV) continue;

      try {
        const cleanTitle = wl.title.split(':')[0].trim();
        const res = await axios.get(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(cleanTitle)}&embed=episodes`, {
          timeout: 6000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'application/json'
          }
        });

        const show: TVMazeShow = res.data;
        if (!show || !show._embedded?.episodes) continue;

        const platform = show.webChannel?.name || show.network?.name || 'Streaming';
        const episodes = show._embedded.episodes || [];

        // Filter episodes that have already aired or are airing today
        const airedEpisodes = episodes.filter(e => {
          if (!e.airdate) return false;
          // Compare airdate with today or check if timestamp has passed
          return e.airdate <= today || new Date(`${e.airdate}T00:00:00Z`).getTime() <= nowMs;
        });

        if (airedEpisodes.length > 0) {
          // Take the latest aired episode
          const latestEp = airedEpisodes[airedEpisodes.length - 1];
          const sNum = `S${String(latestEp.season).padStart(2, '0')}`;
          const eNum = `E${String(latestEp.number).padStart(2, '0')}`;
          const epCode = `${sNum}${eNum}`;

          const isAiredToday = latestEp.airdate === today;
          const status = isAiredToday
            ? `🎉 Airing Today on ${platform}: ${epCode} "${latestEp.name}"`
            : `📺 Aired on ${platform}: ${epCode} "${latestEp.name}" (${latestEp.airdate})`;

          items.push({
            title: `${wl.title} ${epCode}`,
            year: wl.year,
            type: wl.type,
            releaseType: status,
            sourceUrl: `https://www.tvmaze.com/episodes/${latestEp.id}`,
            provider: `TVMaze (${platform})`,
            poster: latestEp.image?.original || show.image?.original || null,
            overview: latestEp.summary ? latestEp.summary.replace(/<[^>]*>/g, '') : undefined,
          });
        }
      } catch (err: any) {
        // Continue silently on single show lookup miss
      }
    }

    if (items.length > 0) {
      await logSuccess(`TVMaze Radar verified streaming schedule for ${items.length} series.`, 'TVMazeRadar');
    }
    return items;
  }
}
