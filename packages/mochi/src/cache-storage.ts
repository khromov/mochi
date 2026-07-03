import { mkdirSync, rmSync } from 'node:fs';
import { readdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Storage } from './cache';
import { mochiEvents } from './events';
import { logger } from './log';

export class MemoryStorage implements Storage {
  private store = new Map<string, unknown>();

  getItem(key: string): unknown {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export interface FileStorageOptions {
  /** Directory where cache files are written. Created if it doesn't exist. */
  directory: string;
  /** Delete the directory's existing contents when the adapter is constructed. Default `false`. */
  purgeOnInit?: boolean;
  /** Background sweep interval (ms) that deletes expired files. Default `60_000`. `<= 0` disables the sweeper. */
  purgeInterval?: number;
  /** Files older than this (ms) are deleted by the sweep. Should be `>=` the cache's `maxTimeToLive`. Default `600_000`. */
  maxAge?: number;
}

const isENOENT = (err: unknown): boolean => (err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';

let tmpCounter = 0;

/**
 * Persists each cache entry as a JSON file (`<sha256(key)>.json`) under `directory`.
 * The entry's own `createdAt` drives stale-while-revalidate, so this backend is a
 * drop-in for `MemoryStorage` — the sweep only removes files past `maxAge`, which
 * the cache would recompute anyway, so it never deletes a still-servable entry.
 */
export class FileStorage implements Storage {
  private directory: string;
  private maxAge: number;
  private initialTimer?: ReturnType<typeof setTimeout>;
  private intervalTimer?: ReturnType<typeof setInterval>;

  constructor(options: FileStorageOptions) {
    this.directory = options.directory;
    this.maxAge = options.maxAge ?? 600_000;

    if (options.purgeOnInit) {
      rmSync(this.directory, { recursive: true, force: true });
    }
    mkdirSync(this.directory, { recursive: true });

    const purgeInterval = options.purgeInterval ?? 60_000;
    if (purgeInterval > 0) {
      this.startSweeper(purgeInterval);
    }
  }

  async getItem(key: string): Promise<unknown> {
    let text: string;
    try {
      text = await Bun.file(this.pathFor(key)).text();
    } catch (err) {
      // A missing file is a cache miss; any other read error propagates so the
      // cache can degrade to a `miss` + `cache:error` rather than serving garbage.
      if (isENOENT(err)) {
        return null;
      }
      throw err;
    }
    return JSON.parse(text);
  }

  async setItem(key: string, value: unknown): Promise<void> {
    const path = this.pathFor(key);
    // Write to a unique temp file then rename into place — rename is atomic on the
    // same filesystem, so a concurrent `getItem` never reads a half-written file.
    const tmp = `${path}.${process.pid}.${tmpCounter++}.tmp`;
    await Bun.write(tmp, JSON.stringify(value));
    await rename(tmp, path);
  }

  async removeItem(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch (err) {
      if (!isENOENT(err)) {
        throw err;
      }
    }
  }

  async clear(): Promise<void> {
    const entries = await readdir(this.directory).catch((err) => {
      if (isENOENT(err)) {
        return [] as string[];
      }
      throw err;
    });
    await Promise.all(
      entries
        .filter((name) => name.endsWith('.json') || name.endsWith('.tmp'))
        .map((name) => unlink(join(this.directory, name)).catch((err) => (isENOENT(err) ? undefined : Promise.reject(err)))),
    );
  }

  /** Delete files older than `maxAge`. Public so callers/tests can sweep on demand. */
  async sweep(now: number = Date.now()): Promise<{ removed: number }> {
    const entries = await readdir(this.directory).catch((err) => {
      if (isENOENT(err)) {
        return [] as string[];
      }
      throw err;
    });
    let removed = 0;
    await Promise.all(
      entries
        .filter((name) => name.endsWith('.json') || name.endsWith('.tmp'))
        .map(async (name) => {
          const filePath = join(this.directory, name);
          try {
            const info = await stat(filePath);
            if (now - info.mtimeMs > this.maxAge) {
              await unlink(filePath);
              removed++;
            }
          } catch (err) {
            if (!isENOENT(err)) {
              throw err;
            }
          }
        }),
    );
    return { removed };
  }

  /** Stop the background sweep. Call when the cache is no longer needed (e.g. in tests). */
  dispose(): void {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
    }
    this.initialTimer = undefined;
    this.intervalTimer = undefined;
  }

  private pathFor(key: string): string {
    const hash = new Bun.CryptoHasher('sha256').update(key).digest('hex');
    return join(this.directory, `${hash}.json`);
  }

  private startSweeper(intervalMs: number): void {
    const run = async (): Promise<void> => {
      const start = Date.now();
      try {
        const { removed } = await this.sweep(start);
        mochiEvents.emit('cache:sweep', { removed, durationMs: Date.now() - start });
      } catch (err) {
        logger.warn(`Cache sweep failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    // An initial pass shortly after boot reclaims accrued cruft and makes the
    // sweeper visible right away; both timers are unref'd so they never keep the
    // process alive.
    this.initialTimer = setTimeout(run, 1_000);
    this.intervalTimer = setInterval(run, intervalMs);
    this.initialTimer.unref?.();
    this.intervalTimer.unref?.();
  }
}
