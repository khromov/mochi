CREATE SCHEMA IF NOT EXISTS mochi_cache;

CREATE TABLE IF NOT EXISTS mochi_cache.entries (
  namespace  text   NOT NULL,
  key        text   NOT NULL,
  value      text   NOT NULL,
  written_at bigint NOT NULL,
  PRIMARY KEY (namespace, key)
);

CREATE INDEX IF NOT EXISTS mochi_cache_entries_written_at_idx
  ON mochi_cache.entries (namespace, written_at);
