Schema for `SqliteStorage` / `PostgresStorage`, tracked in `mochi_migrations_cache`. The storage applies it to its own
database on first use (`migrations/storeMigrations.ts`); `Mochi.serve({ storage })` never does. Same rules as user
migrations: forward-only, consecutive ids from 1, immutable once released. The files are imported as text
(`index.ts`), so add each new file there too.
