CREATE TABLE `conversation_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`workspace_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`run_id` text,
	`event` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_conversation_events_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`),
	CONSTRAINT `fk_conversation_events_workspace_id_conversation_id_conversations_workspace_id_id_fk` FOREIGN KEY (`workspace_id`,`conversation_id`) REFERENCES `conversations`(`workspace_id`,`id`),
	CONSTRAINT `fk_conversation_events_workspace_id_run_id_runs_workspace_id_id_fk` FOREIGN KEY (`workspace_id`,`run_id`) REFERENCES `runs`(`workspace_id`,`id`),
	CONSTRAINT `conversation_events_workspace_id_id_unique` UNIQUE(`workspace_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`author_kind` text NOT NULL,
	`bot_id` text,
	`run_id` text,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_messages_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`),
	CONSTRAINT `fk_messages_workspace_id_conversation_id_conversations_workspace_id_id_fk` FOREIGN KEY (`workspace_id`,`conversation_id`) REFERENCES `conversations`(`workspace_id`,`id`),
	CONSTRAINT `fk_messages_workspace_id_run_id_runs_workspace_id_id_fk` FOREIGN KEY (`workspace_id`,`run_id`) REFERENCES `runs`(`workspace_id`,`id`),
	CONSTRAINT `fk_messages_workspace_id_conversation_id_bot_id_conversation_participants_workspace_id_conversation_id_bot_id_fk` FOREIGN KEY (`workspace_id`,`conversation_id`,`bot_id`) REFERENCES `conversation_participants`(`workspace_id`,`conversation_id`,`bot_id`),
	CONSTRAINT `messages_workspace_id_id_unique` UNIQUE(`workspace_id`,`id`),
	CONSTRAINT "messages_author" CHECK(("author_kind" = 'owner' AND "bot_id" IS NULL AND "run_id" IS NULL) OR ("author_kind" = 'bot' AND "bot_id" IS NOT NULL AND "run_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`session_id` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_login_id` text NOT NULL,
	`input_message_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	CONSTRAINT `fk_runs_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`),
	CONSTRAINT `fk_runs_workspace_id_conversation_id_bot_id_session_id_sessions_workspace_id_conversation_id_bot_id_id_fk` FOREIGN KEY (`workspace_id`,`conversation_id`,`bot_id`,`session_id`) REFERENCES `sessions`(`workspace_id`,`conversation_id`,`bot_id`,`id`),
	CONSTRAINT `fk_runs_workspace_id_input_message_id_messages_workspace_id_id_fk` FOREIGN KEY (`workspace_id`,`input_message_id`) REFERENCES `messages`(`workspace_id`,`id`),
	CONSTRAINT `runs_workspace_id_id_unique` UNIQUE(`workspace_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`status` text NOT NULL,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	CONSTRAINT `fk_sessions_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`),
	CONSTRAINT `fk_sessions_workspace_id_conversation_id_bot_id_conversation_participants_workspace_id_conversation_id_bot_id_fk` FOREIGN KEY (`workspace_id`,`conversation_id`,`bot_id`) REFERENCES `conversation_participants`(`workspace_id`,`conversation_id`,`bot_id`),
	CONSTRAINT `sessions_workspace_id_id_unique` UNIQUE(`workspace_id`,`id`),
	CONSTRAINT `sessions_workspace_id_conversation_id_bot_id_id_unique` UNIQUE(`workspace_id`,`conversation_id`,`bot_id`,`id`)
);
--> statement-breakpoint
CREATE INDEX `conversation_events_conversation` ON `conversation_events` (`workspace_id`,`conversation_id`,`id`);--> statement-breakpoint
CREATE INDEX `messages_conversation` ON `messages` (`workspace_id`,`conversation_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `runs_one_running` ON `runs` (`session_id`) WHERE "runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX `runs_session_status` ON `runs` (`session_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_one_open` ON `sessions` (`conversation_id`,`bot_id`) WHERE "sessions"."status" = 'open';
--> statement-breakpoint
CREATE TRIGGER `sessions_workspace_id_immutable` BEFORE UPDATE OF `workspace_id` ON `sessions`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN SELECT RAISE(ABORT, 'workspace_id is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `runs_workspace_id_immutable` BEFORE UPDATE OF `workspace_id` ON `runs`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN SELECT RAISE(ABORT, 'workspace_id is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `messages_workspace_id_immutable` BEFORE UPDATE OF `workspace_id` ON `messages`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN SELECT RAISE(ABORT, 'workspace_id is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `conversation_events_workspace_id_immutable` BEFORE UPDATE OF `workspace_id` ON `conversation_events`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN SELECT RAISE(ABORT, 'workspace_id is immutable'); END;