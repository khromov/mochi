import path from 'node:path';

/**
 * The app database Mochi manages: a SQLite file or a Postgres URL. Today it drives startup migrations
 * (`Mochi.serve({ storage })` / `Mochi.worker({ storage })`); other storage options (`queueStorage`, …) will
 * converge on this shape.
 */
export type MochiStorage = { sqlite: string } | { postgres: string };

/** Runtime-validates what the types already promise, because `storage` often arrives from untyped config. */
export function isValidStorage(value: unknown): value is MochiStorage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const keys = Object.keys(value).filter((key) => key === 'sqlite' || key === 'postgres');
  if (keys.length !== 1) {
    return false;
  }
  const backing = (value as Record<string, unknown>)[keys[0]!];
  return typeof backing === 'string' && backing.length > 0;
}

export function storageDbType(storage: MochiStorage): 'sqlite' | 'postgres' {
  return 'sqlite' in storage ? 'sqlite' : 'postgres';
}

/** Stable per-database identity, used to dedupe startup migration runs within one process. */
export function storageKey(storage: MochiStorage): string {
  return 'sqlite' in storage ? `sqlite:${path.resolve(storage.sqlite)}` : `postgres:${storage.postgres}`;
}
