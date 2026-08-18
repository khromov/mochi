import { SQL } from 'bun';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Shared by queue and options storage config, which accept the same three object shapes.
const storageChecks: Record<string, (value: unknown) => boolean> = {
  sqlite: (value) => typeof value === 'string' && value.length > 0,
  postgres: (value) => typeof value === 'string' && value.length > 0,
  pglite: (value) => {
    const instance = value as { query?: unknown; exec?: unknown } | null;
    return typeof instance === 'object' && instance !== null && typeof instance.query === 'function' && typeof instance.exec === 'function';
  },
};

/** Runtime-validates a `{ sqlite | postgres | pglite }` storage object (exactly one backend named), because storage config often arrives untyped. */
export function isValidStorageObject(storage: unknown): boolean {
  if (typeof storage !== 'object' || storage === null) {
    return false;
  }
  const [entry, ...extra] = Object.entries(storageChecks).filter(([key]) => key in storage);
  if (!entry || extra.length > 0) {
    return false;
  }
  const [key, check] = entry;
  return check((storage as Record<string, unknown>)[key]);
}

/** SQLite bootstrap shared by queues and options: parent dir first, since `sqlite://` creates the file but not its directories. */
export function openSqliteFile(file: string): SQL {
  if (file !== ':memory:') {
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  return new SQL(`sqlite://${file}`);
}
