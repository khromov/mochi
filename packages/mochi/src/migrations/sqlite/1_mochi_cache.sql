CREATE TABLE IF NOT EXISTS mochi_cache (
  namespace  text    NOT NULL,
  key        text    NOT NULL,
  value      text    NOT NULL,
  written_at integer NOT NULL,
  PRIMARY KEY (namespace, key)
);

CREATE INDEX IF NOT EXISTS mochi_cache_written_at_idx
  ON mochi_cache (namespace, written_at);
