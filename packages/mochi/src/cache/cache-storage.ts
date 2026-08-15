import { mkdirSync, rmSync, type Dirent } from 'node:fs';
import { mkdir, open, readdir, rename, rm, stat, unlink, type FileHandle } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { Storage, SweepOptions, SweepResult } from './cache';
import { mochiEvents } from '../events';
import { pinGlobal } from '../utils/globalState';
import { logger } from '../utils/log';

// A closure rather than the instance, so taking a sweeper over needs no public method on `FileStorage` — the registry
// may hold an entry from a different bundled copy of this class.
interface SweeperOwner {
  stop(): void;
}

// Dev HMR rebuilds a module-scope FileStorage on every reload while the previous copy becomes unreachable, so nobody
// is left to dispose() it and its unref'd interval sweeps forever. Keyed by directory since a sweep deletes files by
// mtime; pinned so duplicate bundled framework copies share one registry.
const sweeperOwners = pinGlobal('__mochi_cache_sweeper_owners__', () => new Map<string, SweeperOwner>());

/**
 * On-disk sentinel written in place of a binary field: a pointer (relative to the
 * storage directory) to the offloaded blob file, plus its byte length.
 */
interface BlobPointer {
  __mochiBlob: string;
  bytes: number;
}

/**
 * What `getItem` returns in place of a binary field: an absolute-path reference the caller resolves on demand via
 * {@link readBlobRef}, so a large binary value persists through the cache while metadata reads stay cheap.
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

// Buffer extends Uint8Array, so this covers both.
function isBinary(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

function isBlobPointer(value: unknown): value is BlobPointer {
  return typeof value === 'object' && value !== null && typeof (value as { __mochiBlob?: unknown }).__mochiBlob === 'string';
}

/** On-disk sentinel for a binary field when offloading is off: the bytes inlined as base64. */
interface InlineBinary {
  __mochiBinary: string;
}

function isInlineBinary(value: unknown): value is InlineBinary {
  return typeof value === 'object' && value !== null && typeof (value as { __mochiBinary?: unknown }).__mochiBinary === 'string';
}

/**
 * On-disk wrapper written by `FileStorage`: the plaintext cache key alongside the blob-encoded value. Files are named
 * `sha256(key)`, so storing the key is the only way `keys()` can enumerate them for the dev debug bar. A file lacking the
 * wrapper — corrupt, foreign, or written by an older version — reads as a miss and is overwritten by the next recompute.
 */
interface KeyedEnvelope {
  __mochiKey: string;
  __mochiValue: unknown;
}

function isKeyedEnvelope(value: unknown): value is KeyedEnvelope {
  return typeof value === 'object' && value !== null && '__mochiValue' in value && typeof (value as KeyedEnvelope).__mochiKey === 'string';
}

export interface MemoryStorageOptions {
  /** Entries older than this (ms) are eligible for removal by `sweep()`. Default: unset — `sweep()` never removes anything, matching plain `new MemoryStorage()`'s prior behavior. */
  maxAge?: number;
  /** Background sweep interval (ms) that evicts aged-out entries. Requires `maxAge`. Default: unset (no timer) — call `sweep()` manually, or rely on an external caller-driven janitor (e.g. `ImageCache`'s). */
  purgeInterval?: number;
}

/**
 * In-memory `Storage` backed by a `Map`, which without options holds everything forever. Pass `maxAge` so `sweep()`
 * reclaims aged-out entries — the only way to bound the footprint of a long-lived backend like `ImageCache`'s `storage` override.
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

  count(): number {
    return this.store.size;
  }

  keys(): string[] {
    return [...this.store.keys()];
  }

  /** Delete entries older than `maxAge`. `reportKeys` also returns the keys removed. */
  sweep(now: number = Date.now(), options: SweepOptions = {}): SweepResult {
    if (this.maxAge === undefined) {
      return options.reportKeys ? { removed: 0, removedKeys: [] } : { removed: 0 };
    }
    const removedKeys: string[] = [];
    let removed = 0;
    for (const [key, entry] of this.store) {
      if (now - entry.writtenAt > this.maxAge) {
        this.store.delete(key);
        removed++;
        if (options.reportKeys) {
          removedKeys.push(key);
        }
      }
    }
    return options.reportKeys ? { removed, removedKeys } : { removed };
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
  /** Offload binary fields (`Uint8Array`/`Buffer`) to per-key blob files and return lazy {@link BlobRef}s on read. Default `false` — binaries are inlined as base64 in the JSON and round-trip as `Uint8Array`. */
  offloadBinary?: boolean;
}

const isENOENT = (err: unknown): boolean => (err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';

// Write `data`, fsync it to disk, then return — so a later rename can never
// expose a torn/zero-length file after a crash. Unlike Bun.write, `open` does
// NOT create parent dirs; callers must ensure the directory exists.
async function writeFileDurable(path: string, data: Uint8Array): Promise<void> {
  const fh = await open(path, 'w');
  try {
    await fh.write(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

// TODO: Audit this code on Windows
// Windows fails a rename with EPERM/EACCES/EBUSY when another handle (a concurrent
// reader, the sweep, an antivirus scan) has the destination open, and can briefly
// surface ENOENT on the just-written source before its directory entry settles.
// All are transient — a short backoff clears them. No-op on POSIX, where rename is
// atomic and these never occur.
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOENT']);
async function renameWithRetry(from: string, to: string): Promise<void> {
  if (process.platform !== 'win32') {
    return rename(from, to);
  }
  // Ramp to a 100ms poll and keep retrying for a few seconds: under heavy write
  // contention a peer's handle on the destination can linger longer than a short
  // window, and a rename that ultimately succeeds beats a spurious hard failure.
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (attempt >= 50 || !RENAME_RETRY_CODES.has(code)) {
        throw err;
      }
      await Bun.sleep(Math.min(100, 10 * (attempt + 1)));
    }
  }
}

// fsyncing a directory makes a rename into it survive a crash. Some filesystems reject directory fsync with
// EINVAL/ENOTSUP; the data file is fsynced regardless, so only rename-durability is lost and the failure mode degrades
// to reverting to the prior version.
const DIR_FSYNC_UNSUPPORTED = new Set(['EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR']);
async function fsyncDir(dir: string): Promise<void> {
  let fh: FileHandle | undefined;
  try {
    fh = await open(dir, 'r');
    await fh.sync();
  } catch (err) {
    if (!DIR_FSYNC_UNSUPPORTED.has((err as NodeJS.ErrnoException).code ?? '')) {
      throw err;
    }
  } finally {
    await fh?.close();
  }
}

// The sweep can't distinguish a crash-orphaned blob folder from the live window between a first write's blob renames and
// its JSON rename, since `setItem` commits blobs first — so a sidecar-less folder younger than this counts as in-flight
// and waits for a later sweep. Writes complete in milliseconds, making a few seconds comfortably conservative.
const ORPHAN_BLOB_GRACE_MS = 10_000;

/**
 * Persists each cache entry as `<sha256(key)>.json` under `directory`. The entry's own `createdAt` drives
 * stale-while-revalidate, making this a drop-in for `MemoryStorage`; the sweep removes only files past `maxAge`, which
 * the cache would recompute anyway, so a still-servable entry survives.
 *
 * Binary fields (`Uint8Array`/`Buffer`) anywhere in a value round-trip transparently, inlined as base64 by default and
 * returned as `Uint8Array`. With `offloadBinary: true` each binary is written to its own file in a `<sha256(key)>/`
 * folder and replaced by a pointer, letting a value carry large image bytes without base64 bloat; `getItem` then returns
 * those fields as lazy {@link BlobRef}s, keeping metadata reads cheap. Deleting a key removes its blob folder with it,
 * and pointers already on disk always decode, so flipping the flag leaves existing entries intact.
 */
export class FileStorage implements Storage {
  private directory: string;
  private maxAge: number;
  private offloadBinary: boolean;
  private initialTimer?: ReturnType<typeof setTimeout>;
  private intervalTimer?: ReturnType<typeof setInterval>;
  private sweepKey?: string;
  private sweepOwner?: SweeperOwner;

  constructor(options: FileStorageOptions) {
    this.directory = options.directory;
    this.maxAge = options.maxAge ?? 600_000;
    this.offloadBinary = options.offloadBinary ?? false;

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
    const parsed = JSON.parse(text);
    if (!isKeyedEnvelope(parsed)) {
      return null;
    }
    return this.decodeBlobs(parsed.__mochiValue);
  }

  async setItem(key: string, value: unknown): Promise<void> {
    const hash = this.hashKey(key);
    const path = join(this.directory, `${hash}.json`);
    const blobs: { relPath: string; data: Uint8Array }[] = [];
    const json = this.encodeBlobs(value, hash, blobs);
    // Offloaded blobs are written first, each a durable write plus rename, so a reader seeing the JSON always sees the
    // blobs it points at. Names are content-addressed, so an identical file already on disk needs no rewrite. Unlike
    // `Bun.write`, `open` won't create `<hash>/`, hence the up-front mkdir.
    if (blobs.length > 0) {
      const blobDir = join(this.directory, hash);
      await mkdir(blobDir, { recursive: true });
      for (const b of blobs) {
        const blobPath = join(this.directory, b.relPath);
        if (await Bun.file(blobPath).exists()) {
          continue;
        }
        const blobTmp = `${blobPath}.${crypto.randomUUID()}.tmp`;
        await writeFileDurable(blobTmp, b.data);
        await renameWithRetry(blobTmp, blobPath);
      }
      await fsyncDir(blobDir);
    }
    // A fsynced temp file renamed into place is atomic on the same filesystem, so a concurrent `getItem` can't read a
    // half-written file and a crash can't leave a torn one; the directory fsync carries the rename through a crash too.
    const tmp = `${path}.${crypto.randomUUID()}.tmp`;
    const envelope: KeyedEnvelope = { __mochiKey: key, __mochiValue: json };
    await writeFileDurable(tmp, new TextEncoder().encode(JSON.stringify(envelope)));
    await renameWithRetry(tmp, path);
    await fsyncDir(this.directory);
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

  /** Number of persisted entries — one `<hash>.json` per key. Excludes in-flight `.tmp` writes and blob folders. */
  async count(): Promise<number> {
    const entries = await readdir(this.directory, { withFileTypes: true }).catch((err) => {
      if (isENOENT(err)) {
        return [] as Dirent[];
      }
      throw err;
    });
    return entries.filter((entry) => !entry.isDirectory() && entry.name.endsWith('.json')).length;
  }

  /**
   * Plaintext keys of every persisted entry, read from each file's stored envelope since filenames are `sha256(key)`.
   * This reads every JSON file in the directory, so it suits dev observability rather than a hot path. Legacy files
   * without a stored key are skipped.
   */
  async keys(): Promise<string[]> {
    const entries = await readdir(this.directory, { withFileTypes: true }).catch((err) => {
      if (isENOENT(err)) {
        return [] as Dirent[];
      }
      throw err;
    });
    const files = entries.filter((entry) => !entry.isDirectory() && entry.name.endsWith('.json'));
    // Unreadable/corrupt/legacy files read back as null — omit them from the listing.
    const keys = await Promise.all(files.map((entry) => this.readKey(join(this.directory, entry.name))));
    return keys.filter((key): key is string => key !== null);
  }

  /**
   * Delete files older than `maxAge`, reclaiming each entry's offloaded blob folder along with any orphaned folder whose
   * owning JSON is gone. Public so callers and tests can sweep on demand.
   *
   * `reportKeys` also returns each removed entry's plaintext key, read from its envelope just before the unlink, after
   * which the `sha256(key)` filename makes it unrecoverable. It's opt-in because it costs one extra read per expired
   * entry, but it lets a janitor attribute removals without `keys()` reading the whole directory. `.tmp` writes and
   * corrupt or legacy files carry no recoverable key, so they count toward `removed` alone.
   */
  async sweep(now: number = Date.now(), options: SweepOptions = {}): Promise<SweepResult> {
    const entries = await readdir(this.directory, { withFileTypes: true }).catch((err) => {
      if (isENOENT(err)) {
        return [] as Dirent[];
      }
      throw err;
    });
    let removed = 0;
    const removedKeys: string[] = [];

    // Pass 1: aged-out JSON/tmp files, each taking its blob folder with it.
    await Promise.all(
      entries
        .filter((entry) => !entry.isDirectory() && (entry.name.endsWith('.json') || entry.name.endsWith('.tmp')))
        .map(async (entry) => {
          const filePath = join(this.directory, entry.name);
          // A `.tmp` is crash debris or a live write's in-flight temp, so it ages out by the crash-orphan grace instead
          // of `maxAge` — under a tiny `maxAge` a slow Windows write would otherwise be unlinked mid-write, ENOENT-ing its own rename.
          const threshold = entry.name.endsWith('.tmp') ? ORPHAN_BLOB_GRACE_MS : this.maxAge;
          try {
            const info = await stat(filePath);
            if (now - info.mtimeMs > threshold) {
              if (options.reportKeys && entry.name.endsWith('.json')) {
                const key = await this.readKey(filePath);
                if (key !== null) {
                  removedKeys.push(key);
                }
              }
              await unlink(filePath);
              removed++;
              if (entry.name.endsWith('.json')) {
                const blobDir = join(this.directory, entry.name.slice(0, -'.json'.length));
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

    // Pass 2 reclaims blob folders whose owning JSON is gone — swept in pass 1, lost to a crash, or an in-flight first
    // write whose JSON hasn't landed, which the mtime grace below protects since a rename into the folder refreshes its mtime.
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
            await rm(dir, { recursive: true, force: true });
          }
        }),
    );

    return options.reportKeys ? { removed, removedKeys } : { removed };
  }

  private stopSweepTimers(): void {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
    }
    this.initialTimer = undefined;
    this.intervalTimer = undefined;
  }

  /** Stop the background sweep. Call when the cache is no longer needed (e.g. in tests). */
  dispose(): void {
    this.stopSweepTimers();
    // A newer instance may have taken the directory over and must keep sweeping it.
    if (this.sweepKey !== undefined && sweeperOwners.get(this.sweepKey) === this.sweepOwner) {
      sweeperOwners.delete(this.sweepKey);
    }
    this.sweepKey = undefined;
    this.sweepOwner = undefined;
  }

  // The plaintext key stored in a file's envelope, or null if it can't be recovered
  // (unreadable, corrupt, or a legacy file written before envelopes).
  private async readKey(filePath: string): Promise<string | null> {
    try {
      const parsed = JSON.parse(await Bun.file(filePath).text());
      return isKeyedEnvelope(parsed) ? parsed.__mochiKey : null;
    } catch {
      return null;
    }
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

  // Deep-clones `value`, replacing binary fields with on-disk pointers and pushing their bytes onto `blobs`, leaving the
  // input untouched. An existing BlobRef — one re-persisted by `markStale` — re-points at its current blob file. Fresh
  // binaries are content-addressed by `sha256(bytes)`, so a filename always implies its bytes: a rewrite lands in a new
  // file that a live lazy BlobRef can't be reading, and identical bytes dedupe. Superseded blobs are reclaimed with the
  // whole entry folder by `removeItem` or the sweep.
  private encodeBlobs(value: unknown, hash: string, blobs: { relPath: string; data: Uint8Array }[]): unknown {
    if (isBinary(value)) {
      if (!this.offloadBinary) {
        return { __mochiBinary: Buffer.from(value).toString('base64') } satisfies InlineBinary;
      }
      const digest = new Bun.CryptoHasher('sha256').update(value).digest('hex');
      const relPath = `${hash}/${digest}.bin`;
      blobs.push({ relPath, data: value });
      return { __mochiBlob: relPath, bytes: value.byteLength } satisfies BlobPointer;
    }
    if (isBlobRef(value)) {
      const relPath = relative(this.directory, value.path);
      return { __mochiBlob: relPath, bytes: value.bytes } satisfies BlobPointer;
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.encodeBlobs(v, hash, blobs));
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.encodeBlobs(v, hash, blobs);
      }
      return out;
    }
    return value;
  }

  // Inverse of `encodeBlobs`: turn on-disk pointers back into lazy BlobRefs and
  // inlined base64 back into bytes. Both sentinels are self-describing, so entries
  // written under either `offloadBinary` setting decode regardless of the flag.
  private decodeBlobs(value: unknown): unknown {
    if (isBlobPointer(value)) {
      return { __mochiBlobRef: true, path: join(this.directory, value.__mochiBlob), bytes: value.bytes } satisfies BlobRef;
    }
    if (isInlineBinary(value)) {
      return new Uint8Array(Buffer.from(value.__mochiBinary, 'base64'));
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
    // Newest wins: an older instance is usually a dead HMR copy, and first-wins would pin the sweep to one that
    // `dispose()` can never reach.
    const key = resolve(this.directory);
    sweeperOwners.get(key)?.stop();
    this.sweepKey = key;
    this.sweepOwner = { stop: () => this.stopSweepTimers() };

    // An initial pass shortly after boot reclaims accrued cruft and makes the
    // sweeper visible right away; both timers are unref'd so they never keep the
    // process alive.
    this.initialTimer = setTimeout(run, 1_000);
    this.intervalTimer = setInterval(run, intervalMs);
    this.initialTimer.unref?.();
    this.intervalTimer.unref?.();
    sweeperOwners.set(key, this.sweepOwner);
  }
}
