CREATE TABLE `memory_items` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`tags` text NOT NULL,
	`resource` text,
	`body` text NOT NULL,
	`created_by` text NOT NULL,
	`created_run_id` text,
	`updated_by` text NOT NULL,
	`updated_run_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_memory_items_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`),
	CONSTRAINT `fk_memory_items_workspace_id_bot_id_bots_workspace_id_id_fk` FOREIGN KEY (`workspace_id`,`bot_id`) REFERENCES `bots`(`workspace_id`,`id`),
	CONSTRAINT `fk_memory_items_workspace_id_created_run_id_runs_workspace_id_id_fk` FOREIGN KEY (`workspace_id`,`created_run_id`) REFERENCES `runs`(`workspace_id`,`id`),
	CONSTRAINT `fk_memory_items_workspace_id_updated_run_id_runs_workspace_id_id_fk` FOREIGN KEY (`workspace_id`,`updated_run_id`) REFERENCES `runs`(`workspace_id`,`id`),
	CONSTRAINT `memory_items_workspace_id_id_unique` UNIQUE(`workspace_id`,`id`)
);
--> statement-breakpoint
CREATE INDEX `memory_items_bot` ON `memory_items` (`workspace_id`,`bot_id`,`id`);--> statement-breakpoint
CREATE INDEX `memory_items_created_run` ON `memory_items` (`workspace_id`,`created_run_id`);--> statement-breakpoint
CREATE INDEX `memory_items_updated_run` ON `memory_items` (`workspace_id`,`updated_run_id`);--> statement-breakpoint
CREATE TRIGGER `memory_items_workspace_id_immutable` BEFORE UPDATE OF `workspace_id` ON `memory_items`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN SELECT RAISE(ABORT, 'workspace_id is immutable'); END;
