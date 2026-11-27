CREATE TABLE mochi_cache (
  namespace  text   NOT NULL,
  key_hash   text   NOT NULL,
  key_json   text   NOT NULL,
  value      text   NOT NULL,
  written_at bigint NOT NULL,
  PRIMARY KEY (namespace, key_hash)
);

CREATE INDEX mochi_cache_written_at_idx
  ON mochi_cache (namespace, written_at);
