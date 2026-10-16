CREATE TABLE `fixture_folders` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	CONSTRAINT `fk_fixture_folders_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`),
	CONSTRAINT `fixture_folders_workspace_id_id_unique` UNIQUE(`workspace_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `fixture_notes` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`folder_id` text NOT NULL,
	`body` text NOT NULL,
	CONSTRAINT `fk_fixture_notes_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`),
	CONSTRAINT `fk_fixture_notes_workspace_id_folder_id_fixture_folders_workspace_id_id_fk` FOREIGN KEY (`workspace_id`,`folder_id`) REFERENCES `fixture_folders`(`workspace_id`,`id`),
	CONSTRAINT `fixture_notes_workspace_id_id_unique` UNIQUE(`workspace_id`,`id`)
);
--> statement-breakpoint
CREATE TRIGGER `fixture_folders_workspace_id_immutable` BEFORE UPDATE OF `workspace_id` ON `fixture_folders`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN SELECT RAISE(ABORT, 'workspace_id is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `fixture_notes_workspace_id_immutable` BEFORE UPDATE OF `workspace_id` ON `fixture_notes`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN SELECT RAISE(ABORT, 'workspace_id is immutable'); END;
