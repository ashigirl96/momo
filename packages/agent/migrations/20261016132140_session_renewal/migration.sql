ALTER TABLE `sessions` ADD `bot_instructions_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `closed_by` text;--> statement-breakpoint
CREATE TRIGGER `sessions_closed_read_only` BEFORE UPDATE ON `sessions`
WHEN OLD.`status` = 'closed'
BEGIN SELECT RAISE(ABORT, 'a closed Session is read-only'); END;
--> statement-breakpoint
CREATE TRIGGER `runs_open_session_only` BEFORE INSERT ON `runs`
WHEN NOT EXISTS (SELECT 1 FROM `sessions` WHERE `id` = NEW.`session_id` AND `status` = 'open')
BEGIN SELECT RAISE(ABORT, 'a Run needs an open Session'); END;
