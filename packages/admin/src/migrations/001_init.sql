-- Initial schema for the Mochi admin template.
--
-- This file is a real, readable migration to demonstrate the file convention
-- (migrations/NNN_name.sql, applied in order). The runner in lib/db.server.ts
-- is currently a stub, so this SQL is NOT executed yet — see tasks/migrations.md.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,          -- opaque, cryptographically-random id
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data       TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE products (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL,
  sku   TEXT NOT NULL UNIQUE,
  price INTEGER NOT NULL,               -- whole currency units
  stock INTEGER NOT NULL DEFAULT 0
);

-- Seed the demo admin user. The password_hash is a placeholder; the real value
-- comes from Bun.password.hash('mochi') once the hashing battery is wired in.
INSERT INTO users (username, password_hash) VALUES ('admin', '$stub$');

INSERT INTO products (name, sku, price, stock) VALUES
  ('Mochi Pro Subscription', 'MOCH-PRO', 30, 999),
  ('Daifuku Tee — Sakura', 'TEE-SKR-01', 25, 142),
  ('Strawberry Plush', 'PLSH-STR', 20, 38),
  ('Sticker Pack v3', 'STK-V3', 5, 512),
  ('Hoodie — Matcha', 'HD-MTC', 60, 0);
