import path from 'node:path';

interface MochiStorageBase {
  /** Boot even when a migration fails (the error is logged). Default: `false`. */
  startOnFail?: boolean;
}

export interface MochiSqliteStorage extends MochiStorageBase {
  type: 'sqlite';
  path: string;
}

export interface MochiPostgresStorage extends MochiStorageBase {
  type: 'postgres';
  url: string;
}

/**
 * The app database Mochi manages. Today it drives startup migrations (`Mochi.serve({ storage })` /
 * `Mochi.worker({ storage })`); other storage options (`queueStorage`, …) will converge on this shape.
 */
export type MochiStorage = MochiSqliteStorage | MochiPostgresStorage;

/**
 * Runtime-validates what the types already promise, because `storage` often arrives from untyped config.
 * Deliberately strict: an unknown key (e.g. a typo'd backing field) is rejected rather than ignored.
 */
export function isValidStorage(value: unknown): value is MochiStorage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const backing = record.type === 'sqlite' ? 'path' : record.type === 'postgres' ? 'url' : null;
  if (!backing || typeof record[backing] !== 'string' || record[backing] === '') {
    return false;
  }
  if (record.startOnFail !== undefined && typeof record.startOnFail !== 'boolean') {
    return false;
  }
  return Object.keys(record).every((key) => key === 'type' || key === backing || key === 'startOnFail');
}

/** Stable per-database identity, used to dedupe startup migration runs within one process. */
export function storageKey(storage: MochiStorage): string {
  return storage.type === 'sqlite' ? `sqlite:${path.resolve(storage.path)}` : `postgres:${storage.url}`;
}
