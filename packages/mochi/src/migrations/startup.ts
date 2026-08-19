import path from 'node:path';
import { pinGlobal } from '../utils/globalState';
import { logger } from '../utils/log';
import { runMigrations } from './runner';
import type { AppliedMigration } from './runner';
import { storageDbType, storageKey } from './storage';
import type { MochiStorage } from './storage';

// Resolves to this directory both in the repo and in the published package (src/ ships verbatim).
const FRAMEWORK_MIGRATIONS_DIR = path.dirname(Bun.fileURLToPath(import.meta.url));

/**
 * Resolved from the current working directory (the project root at launch) rather than the entry's
 * `import.meta.dir`, which dev HMR relocates into `.mochi/dev/…`.
 */
function userMigrationsDir(dbType: 'sqlite' | 'postgres'): string {
  return path.resolve(process.cwd(), 'migrations', dbType);
}

// Keyed per database so Mochi.serve() and Mochi.worker() on the same storage share one run per process.
const runs = pinGlobal<Map<string, Promise<AppliedMigration[]>>>('__mochi_migrations_runs__', () => new Map());

/** Apply framework-internal migrations (`mochi_migrations`) and then the app's (`migrations`) against `storage`. */
export function runStartupMigrations(storage: MochiStorage): Promise<AppliedMigration[]> {
  const key = storageKey(storage);
  let run = runs.get(key);
  if (!run) {
    run = migrateAll(storage);
    runs.set(key, run);
    // A failed boot may be retried (e.g. a worker restarting in-process) — don't poison the retry.
    run.catch(() => runs.delete(key));
  }
  return run;
}

async function migrateAll(storage: MochiStorage): Promise<AppliedMigration[]> {
  // Random jitter desynchronizes replicas booting simultaneously, so they don't contend for the lock at once.
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 500));
  const dbType = storageDbType(storage);
  try {
    const framework = await runMigrations({ storage, dir: path.join(FRAMEWORK_MIGRATIONS_DIR, dbType), table: 'mochi_migrations', label: 'mochi' });
    const app = await runMigrations({ storage, dir: userMigrationsDir(dbType), table: 'migrations', label: 'app' });
    return [...framework, ...app];
  } catch (err) {
    if (storage.startOnFail) {
      logger.error('migrations failed; continuing boot because storage.startOnFail is set:', err);
      return [];
    }
    throw err;
  }
}
