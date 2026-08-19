# Framework-internal SQLite migrations

`.sql` files here are applied by Mochi on startup against the configured `storage`, tracked in the
`mochi_migrations` table (the app's own migrations use `migrations`). Same rules as user migrations:
forward-only, ids consecutive from 1, applied files are immutable.
