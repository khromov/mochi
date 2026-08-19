Framework-internal Postgres migrations, applied on startup into the `mochi_migrations` table before the
app's own — same rules as user migrations: forward-only, consecutive ids from 1, immutable once applied.
