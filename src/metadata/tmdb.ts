import axios from 'axios';
import { Metadata } from '../types';
import { getSettings } from '../services/settings';
import { logInfo, logError, logSuccess, logWarning } from '../services/logger';

export async function fetchMetadata(title: string, year: number, type: string): Promise<Metadata | null> {
  try {
    const settings = await getSettings();
    const apiKey = settings?.metadataApiKey || process.env.TMDB_API_KEY;
    if (!apiKey) {
      return null;
    }

    const isTV = type === 'Series' || type === 'Anime';
    const searchType = isTV ? 'tv' : 'movie';
    const searchUrl = `https://api.themoviedb.org/3/search/${searchType}`;

    const searchParams: Record<string, any> = {
      api_key: apiKey,
      query: title,
    };
    if (year) {
      if (isTV) {
        searchParams.first_air_date_year = year;
      } else {
        searchParams.year = year;
      }
    }

    const searchRes = await axios.get(searchUrl, { params: searchParams, timeout: 5000 });
    let results = searchRes.data?.results || [];

    // Fallback: search without year if no results
    if (results.length === 0 && year) {
      delete searchParams.first_air_date_year;
      delete searchParams.year;
      const retryRes = await axios.get(searchUrl, { params: searchParams, timeout: 5000 });
      results = retryRes.data?.results || [];
    }

    if (results.length === 0) {
      return null;
    }

    const firstResult = results[0];
    const detailsUrl = `https://api.themoviedb.org/3/${searchType}/${firstResult.id}`;
    const detailsRes = await axios.get(detailsUrl, {
      params: {
        api_key: apiKey,
        append_to_response: 'credits',
      },
      timeout: 5000
    });

    const d = detailsRes.data;
    const poster = d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : undefined;
    const genres = d.genres?.map((g: any) => g.name).join(', ');
    const runtime = d.runtime ? `${d.runtime} min` : (d.episode_run_time?.[0] ? `${d.episode_run_time[0]} min` : undefined);
    const country = d.production_countries?.map((c: any) => c.name).join(', ');
    const language = d.spoken_languages?.map((l: any) => l.english_name || l.name).join(', ');
    const cast = d.credits?.cast?.slice(0, 5).map((c: any) => c.name).join(', ');
    const director = d.credits?.crew?.filter((c: any) => c.job === 'Director').map((c: any) => c.name).join(', ');

    return {
      poster,
      overview: d.overview,
      imdbRating: d.vote_average ? `${d.vote_average.toFixed(1)}/10` : undefined,
      genres,
      runtime,
      country,
      language,
      cast,
      director,
      releaseDate: d.release_date || d.first_air_date,
    };
  } catch (error: any) {
    return null;
  }
}
