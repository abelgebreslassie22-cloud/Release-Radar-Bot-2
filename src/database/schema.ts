import { pgTable, serial, text, timestamp, integer, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const watchlist = pgTable('watchlist', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  year: integer('year').notNull(),
  type: text('type').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    watchlistTitleYearTypeIdx: uniqueIndex('watchlist_title_year_type_idx').on(table.title, table.year, table.type),
  };
});

export const releases = pgTable('releases', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  year: integer('year').notNull(),
  type: text('type').notNull(),
  provider: text('provider').notNull(),
  sourceUrl: text('source_url').notNull(),
  releaseType: text('release_type').notNull(), // Web-DL, BluRay, CAM, etc.
  seeders: integer('seeders').default(0),
  leechers: integer('leechers').default(0),
  poster: text('poster'),
  metadataJson: jsonb('metadata_json'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    releasesTitleYearIdx: index('releases_title_year_idx').on(table.title, table.year),
    releasesTitleYearTypeIdx: uniqueIndex('releases_title_year_type_idx').on(table.title, table.year, table.type),
  };
});

export const settings = pgTable('settings', {
  id: serial('id').primaryKey(),
  scanInterval: integer('scan_interval').default(10).notNull(), // minutes
  telegramBotToken: text('telegram_bot_token'),
  telegramChatId: text('telegram_chat_id'),
  metadataApiKey: text('metadata_api_key'),
  debugMode: integer('debug_mode').default(0).notNull(), // 0 = off, 1 = on (using int for simple boolean in simple pg)
  providerType: text('provider_type').default('NONE').notNull(),
  providerUrl: text('provider_url'),
  appUrl: text('app_url'),
  lastScan: timestamp('last_scan'),
  activeInstanceId: text('active_instance_id'),
});

export const logs = pgTable('logs', {
  id: serial('id').primaryKey(),
  level: text('level').notNull(), // INFO, ERROR, WARNING, SUCCESS
  message: text('message').notNull(),
  service: text('service').notNull(),
  details: jsonb('details'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const discoveredReleases = pgTable('discovered_releases', {
  id: serial('id').primaryKey(),
  tmdbId: integer('tmdb_id').notNull(),
  title: text('title').notNull(),
  year: integer('year').notNull(),
  type: text('type').notNull(), // 'Movie' or 'Series'
  category: text('category').notNull(), // 'Movie', 'Series', 'Animation', 'Anime', 'Documentary'
  originCountry: text('origin_country').notNull(), // 'US'
  poster: text('poster'),
  backdrop: text('backdrop'),
  overview: text('overview'),
  voteAverage: text('vote_average'),
  releaseDate: text('release_date'),
  genres: text('genres'),
  downloads: jsonb('downloads'),
  topSeeds: integer('top_seeds').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    discoveredTmdbIdTypeIdx: uniqueIndex('discovered_releases_tmdb_id_type_idx').on(table.tmdbId, table.type),
    discoveredTitleIdx: index('discovered_releases_title_idx').on(table.title),
    discoveredCategoryIdx: index('discovered_releases_category_idx').on(table.category),
  };
});

export const ignoredDownloads = pgTable('ignored_downloads', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  normalizedTitle: text('normalized_title'),
  sourceUrl: text('source_url'),
  infoHash: text('info_hash'),
  episodeCode: text('episode_code'),
  seriesTitle: text('series_title'),
  reason: text('reason').default('user_deleted'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => {
  return {
    ignoredSourceUrlIdx: index('ignored_source_url_idx').on(table.sourceUrl),
    ignoredInfoHashIdx: index('ignored_info_hash_idx').on(table.infoHash),
    ignoredTitleIdx: index('ignored_title_idx').on(table.title),
  };
});

