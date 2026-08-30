import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const leaderboardEntries = sqliteTable("leaderboard_entries", {
  accountHash: text("account_hash").primaryKey(),
  deviceTokenHash: text("device_token_hash").notNull(),
  displayName: text("display_name").notNull(),
  avatarDataUrl: text("avatar_data_url").notNull().default(""),
  allTimeTokens: integer("all_time_tokens").notNull().default(0),
  allTimeCostCents: integer("all_time_cost_cents").notNull().default(0),
  todayTokens: integer("today_tokens").notNull().default(0),
  todayCostCents: integer("today_cost_cents").notNull().default(0),
  todayDate: text("today_date").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
