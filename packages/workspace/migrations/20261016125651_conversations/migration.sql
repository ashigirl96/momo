CREATE TABLE `conversation_participants` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` integer NOT NULL,
	CONSTRAINT `fk_conversation_participants_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`),
	CONSTRAINT `fk_conversation_participants_workspace_id_conversation_id_conversations_workspace_id_id_fk` FOREIGN KEY (`workspace_id`,`conversation_id`) REFERENCES `conversations`(`workspace_id`,`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_conversation_participants_workspace_id_bot_id_bots_workspace_id_id_fk` FOREIGN KEY (`workspace_id`,`bot_id`) REFERENCES `bots`(`workspace_id`,`id`),
	CONSTRAINT `conversation_participants_workspace_id_id_unique` UNIQUE(`workspace_id`,`id`),
	CONSTRAINT `conversation_participants_workspace_id_conversation_id_bot_id_unique` UNIQUE(`workspace_id`,`conversation_id`,`bot_id`)
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_conversations_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`),
	CONSTRAINT `conversations_workspace_id_id_unique` UNIQUE(`workspace_id`,`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_participants_one_primary` ON `conversation_participants` (`conversation_id`) WHERE "conversation_participants"."role" = 'primary';
--> statement-breakpoint
CREATE TRIGGER `conversations_workspace_id_immutable` BEFORE UPDATE OF `workspace_id` ON `conversations`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN SELECT RAISE(ABORT, 'workspace_id is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `conversation_participants_workspace_id_immutable` BEFORE UPDATE OF `workspace_id` ON `conversation_participants`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN SELECT RAISE(ABORT, 'workspace_id is immutable'); END;