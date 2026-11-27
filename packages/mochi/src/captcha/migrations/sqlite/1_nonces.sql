-- IF NOT EXISTS: nonce files created before this migration existed already hold this table and index.
CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);

-- Every consume prunes on expires_at, which the primary key does not index.
CREATE INDEX IF NOT EXISTS nonces_expires_at ON nonces (expires_at);
