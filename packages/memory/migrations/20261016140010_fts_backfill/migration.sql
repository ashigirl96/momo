-- The fts migration only indexes items written after it; index the ones a database already had.
INSERT INTO `memory_fts` (`title`, `description`, `tags`, `body`, `item_id`, `workspace_id`, `bot_id`)
SELECT `title`, `description`, `tags`, `body`, `id`, `workspace_id`, `bot_id` FROM `memory_items`
WHERE `id` NOT IN (SELECT `item_id` FROM `memory_fts`);
