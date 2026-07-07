import { mkdirSync, rmSync, type Dirent } from 'node:fs';
import { readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { Storage } from './cache';
import { mochiEvents } from './events';
import { logger } from './log';

/**
 * On-disk sentinel written in place of a binary field: a pointer (relative to the
 * storage directory) to the offloaded blob file, plus its byte length.
 */
interface BlobPointer {
  __mochiBlob: string;
  bytes: number;
}

/**
 * What `getItem` returns in place of a binary field — an absolute-path reference
 * the caller resolves on demand via {@link readBlobRef}. Metadata reads never
 * load the bytes, so a large binary value can be persisted through the cache while
 * a freshness/metadata read stays cheap.
 */
export interface BlobRef {
  __mochiBlobRef: true;
  path: string;
  bytes: number;
}

export function isBlobRef(value: unknown): value is BlobRef {
  return typeof value === 'object' && value !== null && (value as { __mochiBlobRef?: unknown }).__mochiBlobRef === true;
}

/** Load the bytes behind a {@link BlobRef} returned by `FileStorage.getItem`. */
export async function readBlobRef(ref: BlobRef): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(ref.path).arrayBuffer());
}

/**
 * Like {@link readBlobRef}, but a vanished blob file reads as `null` instead of
 * throwing. A lazy ref can legitimately outlive its file — a newer write for the
 * same key supersedes the blob, or the sweep reclaims the entry — and callers
 * treat that as a cache miss rather than an error.
 */
export async function tryReadBlobRef(ref: BlobRef): Promise<Uint8Array | null> {
  try {
    return await readBlobRef(ref);
  } catch (err) {
    if (isENOENT(err)) {
      return null;
    }
    throw err;
  }
}

// Buffer extends Uint8Array, so this covers both.
function isBinary(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

function isBlobPointer(value: unknown): value is BlobPointer {
  return typeof value === 'object' && value !== null && typeof (value as { __mochiBlob?: unknown }).__mochiBlob === 'string';
}

export interface MemoryStorageOptions {
  /** Entries older than this (ms) are eligible for removal by `sweep()`. Default: unset — `sweep()` never removes anything, matching plain `new MemoryStorage()`'s prior behavior. */
  maxAge?: number;
  /** Background sweep interval (ms) that evicts aged-out entries. Requires `maxAge`. Default: unset (no timer) — call `sweep()` manually, or rely on an external caller-driven janitor (e.g. `ImageCache`'s). */
  purgeInterval?: number;
}

/**
 * In-memory `Storage` backed by a `Map`. With no options it never evicts, same
 * as before `sweep()` existed. Pass `maxAge` to make `sweep()` reclaim aged-out
 * entries — required for a bounded memory footprint when used as a long-lived
 * backend (e.g. `ImageCache`'s `storage` override), since nothing else here
 * reclaims memory.
 */
export class MemoryStorage implements Storage {
  private store = new Map<string, { value: unknown; writtenAt: number }>();
  private readonly maxAge?: number;
  private intervalTimer?: ReturnType<typeof setInterval>;

  constructor(options: MemoryStorageOptions = {}) {
    this.maxAge = options.maxAge;
    if (options.purgeInterval && options.purgeInterval > 0) {
      this.startSweeper(options.purgeInterval);
    }
  }

  getItem(key: string): unknown {
    return this.store.get(key)?.value ?? null;
  }

  setItem(key: string, value: unknown): void {
    this.store.set(key, { value, writtenAt: Date.now() });
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /**
   * Delete entries older than `maxAge`. `freedBytes` is always `0` — unlike
   * `FileStorage`'s file sizes, in-memory values have no cheap byte accounting.
   */
  sweep(now: number = Date.now()): { removed: number; freedBytes: number } {
    if (this.maxAge === undefined) {
      return { removed: 0, freedBytes: 0 };
    }
    let removed = 0;
    for (const [key, entry] of this.store) {
      if (now - entry.writtenAt > this.maxAge) {
        this.store.delete(key);
        removed++;
      }
    }
    return { removed, freedBytes: 0 };
  }

  /** Stop the background sweep. Call when the store is no longer needed (e.g. in tests). */
  dispose(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
    }
    this.intervalTimer = undefined;
  }

  private startSweeper(intervalMs: number): void {
    this.intervalTimer = setInterval(() => {
      const start = Date.now();
      const { removed } = this.sweep(start);
      mochiEvents.emit('cache:sweep', { removed, durationMs: Date.now() - start });
    }, intervalMs);
    this.intervalTimer.unref?.();
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

// The sweep can't tell a crash-orphaned blob folder (safe to reclaim) from the
// live window between a first write's blob renames and its JSON rename —
// `setItem` commits blobs before the JSON, so a sidecar-less folder younger than
// this is treated as an in-flight write and left for a later sweep. Writes
// complete in milliseconds; a few seconds is comfortably conservative.
const ORPHAN_BLOB_GRACE_MS = 10_000;

let tmpCounter = 0;

/**
 * Persists each cache entry as a JSON file (`<sha256(key)>.json`) under `directory`.
 * The entry's own `createdAt` drives stale-while-revalidate, so this backend is a
 * drop-in for `MemoryStorage` — the sweep only removes files past `maxAge`, which
 * the cache would recompute anyway, so it never deletes a still-servable entry.
 *
 * Binary fields (`Uint8Array`/`Buffer`) anywhere in a value are transparently
 * offloaded: each is written to its own file in a `<sha256(key)>/` folder and
 * replaced by a pointer in the JSON, so a value can carry large binaries (e.g.
 * image bytes) without base64-bloating the JSON. `getItem` returns those fields as
 * lazy {@link BlobRef}s (resolved on demand via {@link readBlobRef}), keeping
 * metadata reads cheap. Deleting a key removes its blob folder with it.
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
    return this.decodeBlobs(JSON.parse(text));
  }

  async setItem(key: string, value: unknown): Promise<void> {
    const hash = this.hashKey(key);
    const path = join(this.directory, `${hash}.json`);
    const blobs: { relPath: string; data: Uint8Array }[] = [];
    const referenced = new Set<string>();
    const json = this.encodeBlobs(value, hash, blobs, referenced);
    // Write the offloaded blobs first (each tmp+rename), so a reader that sees the
    // JSON always sees the blobs it points at. Bun.write creates the `<hash>/` dir.
    for (const b of blobs) {
      const blobPath = join(this.directory, b.relPath);
      const blobTmp = `${blobPath}.${process.pid}.${tmpCounter++}.tmp`;
      await Bun.write(blobTmp, b.data);
      await rename(blobTmp, blobPath);
    }
    // Write to a unique temp file then rename into place — rename is atomic on the
    // same filesystem, so a concurrent `getItem` never reads a half-written file.
    const tmp = `${path}.${process.pid}.${tmpCounter++}.tmp`;
    await Bun.write(tmp, JSON.stringify(json));
    await rename(tmp, path);
    await this.reclaimSupersededBlobs(hash, referenced);
  }

  // The JSON rename above is the commit point: any `.bin` in the key's folder the
  // committed JSON doesn't reference is a superseded generation. A reader still
  // holding its lazy BlobRef degrades to ENOENT → `tryReadBlobRef` → miss, which
  // is the consistency contract — it must never see mixed-generation meta/bytes.
  // Temp files are skipped (a concurrent writer's in-progress work). Best-effort:
  // a crash before this runs leaves dead files the key's next write reclaims.
  private async reclaimSupersededBlobs(hash: string, referenced: Set<string>): Promise<void> {
    let files: string[];
    try {
      files = await readdir(join(this.directory, hash));
    } catch {
      return;
    }
    for (const f of files) {
      if (f.endsWith('.bin') && !referenced.has(`${hash}/${f}`)) {
        await unlink(join(this.directory, hash, f)).catch(() => {});
      }
    }
  }

  async removeItem(key: string): Promise<void> {
    const hash = this.hashKey(key);
    try {
      await unlink(join(this.directory, `${hash}.json`));
    } catch (err) {
      if (!isENOENT(err)) {
        throw err;
      }
    }
    // Reclaim the entry's offloaded blob folder, if it had one.
    await rm(join(this.directory, hash), { recursive: true, force: true });
  }

  async clear(): Promise<void> {
    const entries = await readdir(this.directory, { withFileTypes: true }).catch((err) => {
      if (isENOENT(err)) {
        return [] as Dirent[];
      }
      throw err;
    });
    await Promise.all(
      entries.map((entry) => {
        const p = join(this.directory, entry.name);
        // Blob folders are directories; entries and temp writes are files.
        if (entry.isDirectory()) {
          return rm(p, { recursive: true, force: true });
        }
        if (entry.name.endsWith('.json') || entry.name.endsWith('.tmp')) {
          return unlink(p).catch((err) => (isENOENT(err) ? undefined : Promise.reject(err)));
        }
        return undefined;
      }),
    );
  }

  /**
   * Delete files older than `maxAge`, reclaiming each entry's offloaded blob
   * folder with it, plus any orphaned blob folder whose owning JSON is gone.
   * Public so callers/tests can sweep on demand.
   */
  async sweep(now: number = Date.now()): Promise<{ removed: number; freedBytes: number }> {
    const entries = await readdir(this.directory, { withFileTypes: true }).catch((err) => {
      if (isENOENT(err)) {
        return [] as Dirent[];
      }
      throw err;
    });
    let removed = 0;
    let freedBytes = 0;

    // Pass 1: aged-out JSON/tmp files, each taking its blob folder with it.
    await Promise.all(
      entries
        .filter((entry) => !entry.isDirectory() && (entry.name.endsWith('.json') || entry.name.endsWith('.tmp')))
        .map(async (entry) => {
          const filePath = join(this.directory, entry.name);
          try {
            const info = await stat(filePath);
            if (now - info.mtimeMs > this.maxAge) {
              freedBytes += info.size;
              await unlink(filePath);
              removed++;
              if (entry.name.endsWith('.json')) {
                const blobDir = join(this.directory, entry.name.slice(0, -'.json'.length));
                freedBytes += await this.dirSize(blobDir);
                await rm(blobDir, { recursive: true, force: true });
              }
            }
          } catch (err) {
            if (!isENOENT(err)) {
              throw err;
            }
          }
        }),
    );

    // Pass 2: orphaned blob folders whose owning JSON no longer exists (already
    // reclaimed in pass 1, lost to a crash — or an in-flight first write whose
    // JSON hasn't landed yet, which the mtime grace below protects; a rename into
    // the folder refreshes its mtime). `dirSize`/`rm` no-op if gone.
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const ownerExists = await Bun.file(join(this.directory, `${entry.name}.json`)).exists();
          if (!ownerExists) {
            const dir = join(this.directory, entry.name);
            try {
              if (now - (await stat(dir)).mtimeMs <= ORPHAN_BLOB_GRACE_MS) {
                return;
              }
            } catch {
              return; // vanished mid-sweep
            }
            freedBytes += await this.dirSize(dir);
            await rm(dir, { recursive: true, force: true });
          }
        }),
    );

    return { removed, freedBytes };
  }

  /** Sum of the (flat) blob files in a `<hash>/` folder; `0` if it's gone. */
  private async dirSize(dir: string): Promise<number> {
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return 0;
    }
    let total = 0;
    for (const f of files) {
      try {
        total += (await stat(join(dir, f))).size;
      } catch {
        // vanished mid-sweep; ignore
      }
    }
    return total;
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

  private hashKey(key: string): string {
    return new Bun.CryptoHasher('sha256').update(key).digest('hex');
  }

  private pathFor(key: string): string {
    return join(this.directory, `${this.hashKey(key)}.json`);
  }

  /** Absolute path of the JSON file backing `key`. Best-effort locator for callers. */
  pathForKey(key: string): string {
    return this.pathFor(key);
  }

  // Deep-clone `value`, replacing binary fields with on-disk pointers and pushing
  // their bytes onto `blobs` to be written. Never mutates the input. An existing
  // BlobRef (e.g. re-persisted by `markStale`) is re-pointed at its existing blob
  // file without rewriting it. Fresh binaries get generation-unique filenames so
  // a rewrite of the same key never renames new bytes over a file a concurrently
  // issued lazy BlobRef still points at (which would pair old metadata with new
  // bytes); superseded generations are reclaimed by `setItem` after the JSON
  // commits, and `referenced` collects every relPath the outgoing JSON keeps.
  private encodeBlobs(value: unknown, hash: string, blobs: { relPath: string; data: Uint8Array }[], referenced: Set<string>): unknown {
    if (isBinary(value)) {
      const relPath = `${hash}/b${blobs.length}.${process.pid}.${tmpCounter++}.bin`;
      blobs.push({ relPath, data: value });
      referenced.add(relPath);
      return { __mochiBlob: relPath, bytes: value.byteLength } satisfies BlobPointer;
    }
    if (isBlobRef(value)) {
      const relPath = relative(this.directory, value.path);
      referenced.add(relPath);
      return { __mochiBlob: relPath, bytes: value.bytes } satisfies BlobPointer;
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.encodeBlobs(v, hash, blobs, referenced));
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.encodeBlobs(v, hash, blobs, referenced);
      }
      return out;
    }
    return value;
  }

  // Inverse of `encodeBlobs`: turn on-disk pointers back into lazy BlobRefs.
  private decodeBlobs(value: unknown): unknown {
    if (isBlobPointer(value)) {
      return { __mochiBlobRef: true, path: join(this.directory, value.__mochiBlob), bytes: value.bytes } satisfies BlobRef;
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.decodeBlobs(v));
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.decodeBlobs(v);
      }
      return out;
    }
    return value;
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
