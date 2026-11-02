import { pgTable, text, timestamp, boolean, uuid, integer, numeric, date, jsonb, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";

export type BufferChannel = {
  id: string; name: string; displayName?: string | null; service: string; descriptor?: string;
  avatar?: string | null; isDisconnected?: boolean; isLocked?: boolean;
};

export const campaignKind = pgEnum("campaign_kind", ["organic", "ad"]);
export const draftStatus = pgEnum("draft_status", ["draft", "approved", "queued"]);
export const lessonFormat = pgEnum("lesson_format", ["glossary", "prompt_demo", "misconception"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  bufferAccountId: text("buffer_account_id").notNull().unique(),
  email: text("email"),
  displayName: text("display_name"),
  tz: text("tz").notNull().default("America/Chicago"),
  testMode: boolean("test_mode").notNull().default(true),
  // OAuth tokens are stored encrypted (AES-GCM) and refreshed under a row lock.
  accessTokenEnc: text("access_token_enc"),
  refreshTokenEnc: text("refresh_token_enc"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  tokenScope: text("token_scope"),
  // Cached Buffer org + channels so we don't spend shared API quota on every page view.
  orgId: text("org_id"),
  orgName: text("org_name"),
  channelsCache: jsonb("channels_cache").$type<BufferChannel[]>(),
  channelsSyncedAt: timestamp("channels_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  brandColors: jsonb("brand_colors").$type<string[]>().notNull().default([]),
});

export const lessons = pgTable("lessons", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  term: text("term").notNull(),
  definition: text("definition").notNull(),
  example: text("example"),
  format: lessonFormat("format").notNull().default("glossary"),
});

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  productId: uuid("product_id").references(() => products.id),
  name: text("name").notNull(),
  audience: text("audience"),
  angle: text("angle"),
  kind: campaignKind("kind").notNull().default("organic"),
  utmCampaign: text("utm_campaign"),
});

export const drafts = pgTable("drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lessonId: uuid("lesson_id").references(() => lessons.id),
  campaignId: uuid("campaign_id").references(() => campaigns.id),
  perChannelText: jsonb("per_channel_text").$type<Record<string, string>>().notNull().default({}),
  imageUrl: text("image_url"),
  /** cardModelHash() of the model the saved PNG was rendered from (stale when it no longer matches). */
  imageHash: text("image_hash"),
  /** When the image was last saved; also drives the per-user daily image-save limit. */
  imageSavedAt: timestamp("image_saved_at", { withTimezone: true }),
  status: draftStatus("status").notNull().default("draft"),
  approvedHash: text("approved_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bufferPosts = pgTable("buffer_posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  draftId: uuid("draft_id").notNull().references(() => drafts.id, { onDelete: "cascade" }),
  bufferPostId: text("buffer_post_id"),
  contentItemId: text("content_item_id"),
  channelId: text("channel_id").notNull(),
  service: text("service").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  lastStatus: text("last_status"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  externalLink: text("external_link"),
  error: text("error"),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // One row per draft x channel: the idempotency claim for "Send to Buffer".
  uniqueIndex("buffer_posts_draft_channel_uq").on(t.draftId, t.channelId),
]);

export const results = pgTable("results", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  day: date("day").notNull(),
  visits: integer("visits").notNull().default(0),
  purchases: integer("purchases").notNull().default(0),
  revenue: numeric("revenue", { precision: 10, scale: 2 }).notNull().default("0"),
  fees: numeric("fees", { precision: 10, scale: 2 }).notNull().default("0"),
  refunds: numeric("refunds", { precision: 10, scale: 2 }).notNull().default("0"),
  adSpend: numeric("ad_spend", { precision: 10, scale: 2 }).notNull().default("0"),
});
