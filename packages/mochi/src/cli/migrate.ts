import { existsSync } from 'node:fs';
import path from 'node:path';
import { extractServeOptions } from './extractServeOptions';
import { loadMigrationFiles } from '../migrations/loadMigrationFiles';
import { isValidStorage } from '../migrations/storage';
import { runStartupMigrations } from '../migrations/startup';
import { relForDisplay } from '../utils';
import { markBuilding } from '../utils/buildFlag';

export interface MigrateCommandOptions {
  entry?: string;
  validate?: boolean;
}

/**
 * `mochi-framework migrate`: apply pending migrations using the `storage` read from the entry's `Mochi.serve()`
 * or `Mochi.worker()` call, or with `--validate` just check both migration folders' file naming/ordering (no entry
 * import, no database). Throws with a user-facing message on failure; the CLI turns that into exit code 1.
 */
export async function runMigrateCommand(opts: MigrateCommandOptions): Promise<void> {
  if (opts.validate) {
    let total = 0;
    for (const dbType of ['postgres', 'sqlite'] as const) {
      const files = await loadMigrationFiles(path.resolve(process.cwd(), 'migrations', dbType));
      total += files.length;
      if (files.length > 0) {
        process.stdout.write(`[mochi] migrations/${dbType}: ${files.length} valid file(s)\n`);
      }
    }
    if (total === 0) {
      process.stdout.write('[mochi] No migration files found in migrations/postgres or migrations/sqlite.\n');
    }
    return;
  }

  // Same discipline as `build`: this process only reads the entry, so real-boot side effects must stay off.
  markBuilding();

  const entryPath = path.resolve(process.cwd(), opts.entry ?? './src/index.ts');
  const entryLabel = relForDisplay(entryPath) || entryPath;
  if (!existsSync(entryPath)) {
    throw new Error(`Entry not found: ${entryLabel}. Pass --entry <path> to the file calling Mochi.serve() or Mochi.worker().`);
  }
  const serveOptions = await extractServeOptions(entryPath, { interceptWorker: true });
  const storage = serveOptions?.storage;
  if (storage === undefined) {
    throw new Error(
      `No \`storage\` found. Ensure ${entryLabel} calls Mochi.serve({ storage: { type: 'sqlite', path: 'path/to.db' } | { type: 'postgres', url } }) or Mochi.worker({ storage }).`,
    );
  }
  if (!isValidStorage(storage)) {
    throw new Error(`Invalid \`storage\` in ${entryLabel}: expected { type: 'sqlite', path: 'path/to.db' } or { type: 'postgres', url }.`);
  }

  // `startOnFail` only applies to booting a server/worker; the standalone CLI must exit non-zero on failure.
  const applied = await runStartupMigrations({ ...storage, startOnFail: false });
  if (applied.length === 0) {
    process.stdout.write('[mochi] No migrations to apply.\n');
    return;
  }
  process.stdout.write(`[mochi] Applied ${applied.length} migration(s): ${applied.map((m) => m.filename).join(', ')}\n`);
}
