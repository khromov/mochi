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

const SQLITE_MEMORY_RE = /^(sqlite:\/\/|file:)?(?::memory:|.*mode=memory)/i;
const POSTGRES_URL_RE = /^postgres(?:ql)?:\/\/\S+$/i;

function isValidSqlitePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.includes('\0')) {
    return false;
  }
  const trimmed = value.trim();
  // `?` starts a URI query string in Bun.SQL while filesystem helpers treat `path` literally, splitting the target file.
  return trimmed.length > 0 && !trimmed.includes('?') && !SQLITE_MEMORY_RE.test(trimmed);
}

/**
 * Runtime-validates what the types already promise, because `storage` often arrives from untyped config.
 * Deliberately strict: an unknown key (e.g. a typo'd backing field) is rejected rather than ignored.
 */
export function isValidStorage(value: unknown): value is MochiStorage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const backing = record.type === 'sqlite' ? 'path' : record.type === 'postgres' ? 'url' : null;
  if (!backing) {
    return false;
  }
  if (backing === 'path' && !isValidSqlitePath(record.path)) {
    return false;
  }
  if (backing === 'url' && (typeof record.url !== 'string' || record.url.includes('\0') || !POSTGRES_URL_RE.test(record.url.trim()))) {
    return false;
  }
  if (record.startOnFail !== undefined && typeof record.startOnFail !== 'boolean') {
    return false;
  }
  return Object.keys(record).every((key) => key === 'type' || key === backing || key === 'startOnFail');
}

/** Stable per-database identity, used to dedupe startup migration runs within one process. */
export function storageKey(storage: MochiStorage): string {
  return storage.type === 'sqlite' ? `sqlite:${path.resolve(storage.path.trim())}` : `postgres:${storage.url.trim()}`;
}
