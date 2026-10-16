CREATE TABLE `bots` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`instructions` text NOT NULL,
	`model` text NOT NULL,
	`tools` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_bots_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`),
	CONSTRAINT `bots_workspace_id_id_unique` UNIQUE(`workspace_id`,`id`)
);
--> statement-breakpoint
CREATE TRIGGER `bots_workspace_id_immutable` BEFORE UPDATE OF `workspace_id` ON `bots`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN SELECT RAISE(ABORT, 'workspace_id is immutable'); END;
