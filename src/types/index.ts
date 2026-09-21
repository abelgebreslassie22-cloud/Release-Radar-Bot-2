export interface Provider {
  name: string;
  initialize?(): Promise<void>;
  scan(watchlistItems?: { title: string; year: number; type: string }[]): Promise<ReleaseItem[]>;
}

export interface ReleaseItem {
  title: string;
  year: number;
  type: string;
  releaseType: string;
  sourceUrl: string;
  provider?: string;
  poster?: string;
  overview?: string;
  seeders?: number;
  leechers?: number;
}

export interface Metadata {
  poster?: string;
  backdrop?: string;
  overview?: string;
  imdbRating?: string;
  genres?: string;
  runtime?: string;
  country?: string;
  language?: string;
  cast?: string;
  director?: string;
  writer?: string;
  releaseDate?: string;
  trailer?: string;
  productionCompanies?: string;
}
