-- Rebuilds memory_fts with an indexed `bot_key` column, so a search constrains (workspace_id, bot_id)
-- inside MATCH and other Bots' items never become candidates.
DROP TRIGGER `memory_items_fts_insert`;
--> statement-breakpoint
DROP TRIGGER `memory_items_fts_update`;
--> statement-breakpoint
DROP TRIGGER `memory_items_fts_delete`;
--> statement-breakpoint
DROP TABLE `memory_fts`;
--> statement-breakpoint
-- `bot_key` is `<workspace_id/bot_id>`; the brackets make a phrase match on it an exact match.
CREATE VIRTUAL TABLE `memory_fts` USING fts5(
	`bot_key`, `title`, `description`, `tags`, `body`,
	`item_id` UNINDEXED, `workspace_id` UNINDEXED, `bot_id` UNINDEXED,
	tokenize = 'trigram'
);
--> statement-breakpoint
-- Without secure-delete, deleted rows can be rebuilt from the index's delete keys (ADR-0011).
INSERT INTO `memory_fts` (`memory_fts`, `rank`) VALUES ('secure-delete', 1);
--> statement-breakpoint
CREATE TRIGGER `memory_items_fts_insert` AFTER INSERT ON `memory_items` BEGIN
	INSERT INTO `memory_fts` (`bot_key`, `title`, `description`, `tags`, `body`, `item_id`, `workspace_id`, `bot_id`)
	VALUES ('<' || NEW.`workspace_id` || '/' || NEW.`bot_id` || '>', NEW.`title`, NEW.`description`, NEW.`tags`, NEW.`body`, NEW.`id`, NEW.`workspace_id`, NEW.`bot_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `memory_items_fts_update` AFTER UPDATE ON `memory_items` BEGIN
	DELETE FROM `memory_fts` WHERE `item_id` = OLD.`id`;
	INSERT INTO `memory_fts` (`bot_key`, `title`, `description`, `tags`, `body`, `item_id`, `workspace_id`, `bot_id`)
	VALUES ('<' || NEW.`workspace_id` || '/' || NEW.`bot_id` || '>', NEW.`title`, NEW.`description`, NEW.`tags`, NEW.`body`, NEW.`id`, NEW.`workspace_id`, NEW.`bot_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `memory_items_fts_delete` AFTER DELETE ON `memory_items` BEGIN
	DELETE FROM `memory_fts` WHERE `item_id` = OLD.`id`;
END;
--> statement-breakpoint
INSERT INTO `memory_fts` (`bot_key`, `title`, `description`, `tags`, `body`, `item_id`, `workspace_id`, `bot_id`)
SELECT '<' || `workspace_id` || '/' || `bot_id` || '>', `title`, `description`, `tags`, `body`, `id`, `workspace_id`, `bot_id`
FROM `memory_items`;
