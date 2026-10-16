CREATE TABLE `attachments` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`message_id` text NOT NULL,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_attachments_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`),
	CONSTRAINT `fk_attachments_workspace_id_message_id_messages_workspace_id_id_fk` FOREIGN KEY (`workspace_id`,`message_id`) REFERENCES `messages`(`workspace_id`,`id`),
	CONSTRAINT `attachments_workspace_id_id_unique` UNIQUE(`workspace_id`,`id`)
);
--> statement-breakpoint
CREATE INDEX `attachments_message` ON `attachments` (`workspace_id`,`message_id`,`id`);--> statement-breakpoint
CREATE TRIGGER `attachments_workspace_id_immutable` BEFORE UPDATE OF `workspace_id` ON `attachments`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN SELECT RAISE(ABORT, 'workspace_id is immutable'); END;
