-- Full-text index of memory_items (trigram, so Japanese without spaces matches by substring).
-- It keeps its own copy of the text keyed by item_id: an external-content table would key on
-- memory_items' implicit rowid, which VACUUM may renumber.
CREATE VIRTUAL TABLE `memory_fts` USING fts5(
	`title`, `description`, `tags`, `body`,
	`item_id` UNINDEXED, `workspace_id` UNINDEXED, `bot_id` UNINDEXED,
	tokenize = 'trigram'
);
--> statement-breakpoint
-- Without secure-delete, deleted rows can be rebuilt from the index's delete keys (ADR-0011).
INSERT INTO `memory_fts` (`memory_fts`, `rank`) VALUES ('secure-delete', 1);
--> statement-breakpoint
CREATE TRIGGER `memory_items_fts_insert` AFTER INSERT ON `memory_items` BEGIN
	INSERT INTO `memory_fts` (`title`, `description`, `tags`, `body`, `item_id`, `workspace_id`, `bot_id`)
	VALUES (NEW.`title`, NEW.`description`, NEW.`tags`, NEW.`body`, NEW.`id`, NEW.`workspace_id`, NEW.`bot_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `memory_items_fts_update` AFTER UPDATE ON `memory_items` BEGIN
	DELETE FROM `memory_fts` WHERE `item_id` = OLD.`id`;
	INSERT INTO `memory_fts` (`title`, `description`, `tags`, `body`, `item_id`, `workspace_id`, `bot_id`)
	VALUES (NEW.`title`, NEW.`description`, NEW.`tags`, NEW.`body`, NEW.`id`, NEW.`workspace_id`, NEW.`bot_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `memory_items_fts_delete` AFTER DELETE ON `memory_items` BEGIN
	DELETE FROM `memory_fts` WHERE `item_id` = OLD.`id`;
END;
