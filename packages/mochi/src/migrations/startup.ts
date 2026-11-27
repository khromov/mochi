import { existsSync } from 'node:fs';
import path from 'node:path';
import { pinGlobal } from '../utils/globalState';
import { logger } from '../utils/log';
import { runMigrations } from './runner';
import type { AppliedMigration } from './runner';
import { storageKey } from './storage';
import type { MochiStorage } from './storage';

let resolvedFrameworkDir: string | undefined;

function frameworkMigrationsDir(): string {
  if (resolvedFrameworkDir) {
    return resolvedFrameworkDir;
  }
  const local = path.dirname(Bun.fileURLToPath(import.meta.url));
  if (existsSync(path.join(local, 'sqlite')) && existsSync(path.join(local, 'postgres'))) {
    resolvedFrameworkDir = local;
    return local;
  }
  // Inside a compiled SSR chunk (.mochi/…), import.meta.url points into outDir rather than src/migrations/.
  resolvedFrameworkDir = path.join(path.dirname(Bun.resolveSync('mochi-framework', local)), 'migrations');
  return resolvedFrameworkDir;
}

/**
 * Resolved from the current working directory (the project root at launch) rather than the entry's
 * `import.meta.dir`, which dev HMR relocates into `.mochi/dev/…`.
 */
function userMigrationsDir(dbType: 'sqlite' | 'postgres'): string {
  return path.resolve(process.cwd(), 'migrations', dbType);
}

// Keyed per database so Mochi.serve() and Mochi.worker() on the same storage share one run per process.
const runs = pinGlobal<Map<string, Promise<AppliedMigration[]>>>('__mochi_migrations_runs__', () => new Map());
// Shared between Mochi.serve({ storage }) and standalone subsystems (SqliteStorage, PostgresStorage) so they never double-apply or contend.
const internalRuns = pinGlobal<Map<string, Promise<AppliedMigration[]>>>('__mochi_internal_migrations_runs__', () => new Map());

export function ensureInternalMigrations(storage: MochiStorage): Promise<AppliedMigration[]> {
  const key = storageKey(storage);
  let run = internalRuns.get(key);
  if (!run) {
    run = runMigrations({ storage, dir: path.join(frameworkMigrationsDir(), storage.type), table: 'mochi_migrations_internal', label: 'mochi' });
    internalRuns.set(key, run);
    run.catch(() => internalRuns.delete(key));
  }
  return run;
}

/** Drop the memoized internal-migration run once it settles so a recreated test DB at the same path/URL re-migrates cleanly. */
export function clearInternalMigrationsCache(storage: MochiStorage): void {
  const key = storageKey(storage);
  const existing = internalRuns.get(key);
  if (!existing) {
    return;
  }
  void existing.finally(() => {
    if (internalRuns.get(key) === existing) {
      internalRuns.delete(key);
    }
  });
}

/** Apply framework-internal migrations (`mochi_migrations_internal`) and then the app's (`mochi_migrations`) against `storage`. */
export async function runStartupMigrations(storage: MochiStorage): Promise<AppliedMigration[]> {
  const key = storageKey(storage);
  let run = runs.get(key);
  if (!run) {
    run = migrateAll(storage);
    runs.set(key, run);
    // Evict on failure before `startOnFail` is consulted so a swallowed boot never caches `[]` for later callers.
    run.catch(() => runs.delete(key));
  }
  try {
    return await run;
  } catch (err) {
    if (storage.startOnFail) {
      logger.error('migrations failed; continuing boot because storage.startOnFail is set:', err);
      return [];
    }
    throw err;
  }
}

async function migrateAll(storage: MochiStorage): Promise<AppliedMigration[]> {
  // Random jitter desynchronizes replicas booting simultaneously, so they don't contend for the lock at once.
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 500));
  const dbType = storage.type;
  const framework = await ensureInternalMigrations(storage);
  const app = await runMigrations({ storage, dir: userMigrationsDir(dbType), table: 'mochi_migrations', label: 'app' });
  return [...framework, ...app];
}
