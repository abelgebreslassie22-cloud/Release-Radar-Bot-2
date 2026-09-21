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
}, (table) => {
  return {
    releasesTitleYearIdx: index('releases_title_year_idx').on(table.title, table.year),
    releasesSourceUrlIdx: uniqueIndex('releases_source_url_idx').on(table.sourceUrl),
  };
});

export const settings = pgTable('settings', {
  id: serial('id').primaryKey(),
  scanInterval: integer('scan_interval').default(10).notNull(), // minutes
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
