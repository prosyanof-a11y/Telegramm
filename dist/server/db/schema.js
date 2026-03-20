import { pgTable, uuid, text, boolean, timestamp, integer, jsonb, varchar } from 'drizzle-orm/pg-core';
export const users = pgTable('users', {
    id: uuid('id').primaryKey().defaultRandom(),
    telegramId: varchar('telegram_id', { length: 255 }).unique().notNull(),
    username: varchar('username', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});
export const channels = pgTable('channels', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id).notNull(),
    telegramChannelId: varchar('telegram_channel_id', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    niche: text('niche'),
    tone: text('tone'),
    targetAudience: text('target_audience'),
    productDescription: text('product_description'),
    exampleGoodPost: text('example_good_post'),
    postFrequency: integer('post_frequency').default(1),
    active: boolean('active').default(true),
    botAdded: boolean('bot_added').default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});
export const posts = pgTable('posts', {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id').references(() => channels.id).notNull(),
    text: text('text').notNull(),
    imageUrl: text('image_url'),
    status: varchar('status', { length: 50 }).default('draft').notNull(), // draft|pending_approval|approved|published|failed|rejected
    scheduledAt: timestamp('scheduled_at'),
    publishedAt: timestamp('published_at'),
    telegramMessageId: varchar('telegram_message_id', { length: 255 }),
    sourceType: varchar('source_type', { length: 50 }),
    retryCount: integer('retry_count').default(0),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});
export const documents = pgTable('documents', {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id').references(() => channels.id).notNull(),
    filename: varchar('filename', { length: 255 }).notNull(),
    fileUrl: text('file_url'),
    content: text('content'),
    processed: boolean('processed').default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});
export const schedules = pgTable('schedules', {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id').references(() => channels.id).notNull(),
    timeSlots: jsonb('time_slots').notNull(), // array of strings like "10:00", "15:00"
    timezone: varchar('timezone', { length: 50 }).default('UTC').notNull(),
    active: boolean('active').default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});
export const webSearches = pgTable('web_searches', {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id').references(() => channels.id).notNull(),
    query: text('query').notNull(),
    results: jsonb('results'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});
