import axios from 'axios';
import { Provider, ReleaseItem } from '../types';
import { getSettings } from '../services/settings';
import { logInfo, logError, logWarning, logSuccess } from '../services/logger';

export class TMDBPremiereProvider implements Provider {
  name = 'TMDB Premiere Radar';

  private async getApiKey(): Promise<string | null> {
    const settings = await getSettings();
    return settings?.metadataApiKey || process.env.TMDB_API_KEY || null;
  }

  async initialize() {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      await logWarning('TMDB API Key is not configured. Digital & TV premiere scanning will be skipped.', 'TMDBProvider');
    } else {
      await logInfo('TMDB Watchlist Premiere Provider initialized successfully.', 'TMDBProvider');
    }
  }

  async scan(watchlistItems?: { title: string; year: number; type: string }[]): Promise<ReleaseItem[]> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      await logWarning('No TMDB API Key found. Skipping TMDB premiere scan.', 'TMDBProvider');
      return [];
    }

    if (!watchlistItems || watchlistItems.length === 0) {
      await logInfo('Watchlist is empty. Scanner is configured to only search your watchlist.', 'TMDBProvider');
      return [];
    }

    const items: ReleaseItem[] = [];
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    await logInfo(`Searching TMDB exclusively for ${watchlistItems.length} watchlist item(s)...`, 'TMDBProvider');

    for (const item of watchlistItems) {
      try {
        const isTV = item.type?.toLowerCase() === 'series' || item.type?.toLowerCase() === 'anime';

        if (!isTV) {
          // ==================== MOVIE: Single Card per Movie ====================
          const searchRes = await axios.get('https://api.themoviedb.org/3/search/movie', {
            params: {
              api_key: apiKey,
              query: item.title,
              year: item.year || undefined,
            },
            timeout: 7000
          });

          let movies = searchRes.data?.results || [];
          if (movies.length === 0 && item.year) {
            const retryRes = await axios.get('https://api.themoviedb.org/3/search/movie', {
              params: { api_key: apiKey, query: item.title },
              timeout: 7000
            });
            movies = retryRes.data?.results || [];
          }

          if (movies.length > 0) {
            const movie = movies[0];
            const movieId = movie.id;
            const movieTitle = movie.title || item.title;
            const movieYear = movie.release_date ? new Date(movie.release_date).getFullYear() : item.year;
            const moviePoster = movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : undefined;
            const movieOverview = movie.overview;

            // Fetch Release Dates
            const rdRes = await axios.get(`https://api.themoviedb.org/3/movie/${movieId}/release_dates`, {
              params: { api_key: apiKey },
              timeout: 7000
            });

            // Fetch Watch Providers (Streaming / VOD / Rent / Buy)
            let watchData: any = null;
            try {
              const wpRes = await axios.get(`https://api.themoviedb.org/3/movie/${movieId}/watch/providers`, {
                params: { api_key: apiKey },
                timeout: 6000
              });
              watchData = wpRes.data?.results?.US || wpRes.data?.results?.GB || Object.values(wpRes.data?.results || {})[0];
            } catch (err) {
              // optional
            }

            const resultsList = rdRes.data?.results || [];
            let digitalDate: string | null = null;
            let digitalNote: string | null = null;
            let physicalDate: string | null = null;
            let theatricalDate: string | null = null;
            let upcomingDigitalDate: string | null = null;

            for (const country of resultsList) {
              for (const rd of country.release_dates || []) {
                const releaseDate = new Date(rd.release_date);
                const isPremiered = releaseDate <= now;

                // Type 4: Digital
                if (rd.type === 4) {
                  if (isPremiered && !digitalDate) {
                    digitalDate = rd.release_date.split('T')[0];
                    digitalNote = rd.note?.trim() || null;
                  } else if (!isPremiered && !upcomingDigitalDate) {
                    upcomingDigitalDate = rd.release_date.split('T')[0];
                  }
                }
                // Type 5: Physical
                if (rd.type === 5 && isPremiered && !physicalDate) {
                  physicalDate = rd.release_date.split('T')[0];
                }
                // Type 3: Theatrical
                if (rd.type === 3 && isPremiered && !theatricalDate) {
                  theatricalDate = rd.release_date.split('T')[0];
                }
              }
            }

            // Consolidate streaming providers
            const streamers = watchData?.flatrate?.slice(0, 2).map((p: any) => p.provider_name).join(', ') || null;

            // Formulate ONE consolidated status
            const statusParts: string[] = [];
            if (digitalDate) {
              statusParts.push(digitalNote ? `Digital (${digitalNote})` : 'Digital (VOD)');
            } else if (upcomingDigitalDate) {
              statusParts.push(`Digital Premiere: ${upcomingDigitalDate}`);
            }

            if (streamers) {
              statusParts.push(`Stream: ${streamers}`);
            }

            if (!digitalDate && physicalDate) {
              statusParts.push('4K UHD / Blu-ray');
            }

            if (statusParts.length === 0) {
              if (theatricalDate) {
                statusParts.push(`Theatrical (${theatricalDate})`);
              } else {
                statusParts.push(movie.release_date ? `Release: ${movie.release_date}` : 'Upcoming');
              }
            }

            const singleStatus = statusParts.join(' • ');

            // Exactly ONE card for this movie
            items.push({
              title: movieTitle,
              year: movieYear,
              type: 'Movie',
              releaseType: singleStatus,
              sourceUrl: `https://www.themoviedb.org/movie/${movieId}/watch`,
              provider: 'TMDB Premiere Radar',
              poster: moviePoster,
              overview: movieOverview,
            });
          }
        } else {
          // ==================== TV SERIES: Single Card per Show ====================
          const searchRes = await axios.get('https://api.themoviedb.org/3/search/tv', {
            params: {
              api_key: apiKey,
              query: item.title,
              first_air_date_year: item.year || undefined,
            },
            timeout: 7000
          });

          let shows = searchRes.data?.results || [];
          if (shows.length === 0 && item.year) {
            const retryRes = await axios.get('https://api.themoviedb.org/3/search/tv', {
              params: { api_key: apiKey, query: item.title },
              timeout: 7000
            });
            shows = retryRes.data?.results || [];
          }

          if (shows.length > 0) {
            const show = shows[0];
            const showId = show.id;
            const showTitle = show.name || item.title;
            const showYear = show.first_air_date ? new Date(show.first_air_date).getFullYear() : item.year;
            const showPoster = show.poster_path ? `https://image.tmdb.org/t/p/w500${show.poster_path}` : undefined;

            const detailsRes = await axios.get(`https://api.themoviedb.org/3/tv/${showId}`, {
              params: { api_key: apiKey },
              timeout: 7000
            });
            const details = detailsRes.data;

            // Fetch Watch Providers
            let watchData: any = null;
            try {
              const wpRes = await axios.get(`https://api.themoviedb.org/3/tv/${showId}/watch/providers`, {
                params: { api_key: apiKey },
                timeout: 6000
              });
              watchData = wpRes.data?.results?.US || wpRes.data?.results?.GB || Object.values(wpRes.data?.results || {})[0];
            } catch (e) {
              // optional
            }

            const streamers = watchData?.flatrate?.slice(0, 2).map((p: any) => p.provider_name).join(', ') || null;

            const statusParts: string[] = [];

            // Check next episode today
            const nextEp = details?.next_episode_to_air;
            const lastEp = details?.last_episode_to_air;

            if (nextEp && nextEp.air_date === todayStr) {
              const sNum = String(nextEp.season_number).padStart(2, '0');
              const eNum = String(nextEp.episode_number).padStart(2, '0');
              statusParts.push(`Airing Today: S${sNum}E${eNum}${nextEp.name ? ` "${nextEp.name}"` : ''}`);
            } else if (lastEp && lastEp.air_date) {
              const sNum = String(lastEp.season_number).padStart(2, '0');
              const eNum = String(lastEp.episode_number).padStart(2, '0');
              statusParts.push(`Latest: S${sNum}E${eNum}${lastEp.name ? ` "${lastEp.name}"` : ''} (${lastEp.air_date})`);
            } else {
              statusParts.push(details.status || 'Active');
            }

            if (streamers) {
              statusParts.push(`Stream: ${streamers}`);
            }

            const singleStatus = statusParts.join(' • ');
            const cardPoster = (lastEp?.still_path ? `https://image.tmdb.org/t/p/w500${lastEp.still_path}` : null) || showPoster;
            const cardOverview = lastEp?.overview || details.overview || show.overview;

            // Exactly ONE card for this TV Series
            items.push({
              title: showTitle,
              year: showYear,
              type: item.type,
              releaseType: singleStatus,
              sourceUrl: `https://www.themoviedb.org/tv/${showId}`,
              provider: 'TMDB TV Schedule',
              poster: cardPoster,
              overview: cardOverview,
            });
          }
        }
      } catch (itemErr: any) {
        await logWarning(`Error checking premiere for "${item.title}": ${itemErr.message}`, 'TMDBProvider');
      }
    }

    await logSuccess(`TMDB scan completed: ${items.length} watchlist card(s) created.`, 'TMDBProvider');
    return items;
  }
}
