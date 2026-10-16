CREATE TABLE `logins` (
	`id` text PRIMARY KEY,
	`token_hash` text NOT NULL UNIQUE,
	`user_agent` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
