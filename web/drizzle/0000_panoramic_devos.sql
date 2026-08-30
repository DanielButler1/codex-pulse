CREATE TABLE `leaderboard_entries` (
	`account_hash` text PRIMARY KEY NOT NULL,
	`device_token_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`avatar_data_url` text DEFAULT '' NOT NULL,
	`all_time_tokens` integer DEFAULT 0 NOT NULL,
	`all_time_cost_cents` integer DEFAULT 0 NOT NULL,
	`today_tokens` integer DEFAULT 0 NOT NULL,
	`today_cost_cents` integer DEFAULT 0 NOT NULL,
	`today_date` text NOT NULL,
	`updated_at` integer NOT NULL
);
