import { mkdirSync, rmSync, type Dirent } from 'node:fs';
import { mkdir, open, readdir, rename, rm, stat, unlink, type FileHandle } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { Storage, SweepOptions, SweepResult } from './cache';
import { assertNoPurgeInterval, registerSweepable, unregisterSweepable, type SweepableStorage } from './sweepRegistry';
import { mochiEvents } from '../events';
import { logger } from '../utils/log';

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
 * On-disk wrapper written by `FileStorage`: the plaintext cache key alongside the
 * (blob-encoded) value. Since files are named by `sha256(key)`, storing the key
 * is the only way to enumerate keys (`keys()`) for the dev debug bar. A file
 * without the wrapper (corrupt, foreign, or written by an older version) reads
 * as a miss and is overwritten by the next recompute.
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
  /** Let the `mochi:cache-sweep` task evict aged-out entries. Requires `maxAge` — without it there is nothing to evict. Default `true`. Set `false` to drive `sweep()` yourself. */
  purge?: boolean;
}

/**
 * In-memory `Storage` backed by a `Map`. With no options it never evicts, same
 * as before `sweep()` existed. Pass `maxAge` to make `sweep()` reclaim aged-out
 * entries — required for a bounded memory footprint when used as a long-lived
 * backend (e.g. `ImageCache`'s `storage` override), since nothing else here
 * reclaims memory.
 */
export class MemoryStorage implements Storage, SweepableStorage {
  private store = new Map<string, { value: unknown; writtenAt: number }>();
  private readonly maxAge?: number;

  constructor(options: MemoryStorageOptions = {}) {
    assertNoPurgeInterval(options, 'MemoryStorage');
    this.maxAge = options.maxAge;
    // No `maxAge` means `sweep()` is a no-op, so registering would only cost the
    // janitor a pass over an entry that can never evict anything.
    if (options.purge !== false && this.maxAge !== undefined) {
      registerSweepable(this);
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

  sweepAndReport(): void {
    const start = Date.now();
    const { removed } = this.sweep(start);
    mochiEvents.emit('cache:sweep', { removed, durationMs: Date.now() - start });
  }

  /** Detach from the shared sweep. Call when the store is no longer needed (e.g. in tests). */
  dispose(): void {
    unregisterSweepable(this);
  }
}

export interface FileStorageOptions {
  /** Directory where cache files are written. Created if it doesn't exist. */
  directory: string;
  /** Delete the directory's existing contents when the adapter is constructed. Default `false`. */
  purgeOnInit?: boolean;
  /** Let the `mochi:cache-sweep` task delete expired files. Default `true`. Set `false` to drive `sweep()` yourself. */
  purge?: boolean;
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

// fsync a directory so a rename into it survives a crash. Best-effort: some
// filesystems reject directory fsync with EINVAL/ENOTSUP — there the data file
// was still fsynced (no torn read), we only forgo rename-durability, which
// safely degrades to "revert to the prior version".
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

// The sweep can't tell a crash-orphaned blob folder (safe to reclaim) from the
// live window between a first write's blob renames and its JSON rename —
// `setItem` commits blobs before the JSON, so a sidecar-less folder younger than
// this is treated as an in-flight write and left for a later sweep. Writes
// complete in milliseconds; a few seconds is comfortably conservative.
const ORPHAN_BLOB_GRACE_MS = 10_000;

/**
 * Persists each cache entry as a JSON file (`<sha256(key)>.json`) under `directory`.
 * The entry's own `createdAt` drives stale-while-revalidate, so this backend is a
 * drop-in for `MemoryStorage` — the sweep only removes files past `maxAge`, which
 * the cache would recompute anyway, so it never deletes a still-servable entry.
 *
 * Binary fields (`Uint8Array`/`Buffer`) anywhere in a value round-trip
 * transparently: by default they're inlined as base64 in the JSON and come back
 * as `Uint8Array` — nothing to manage. With `offloadBinary: true` each binary is
 * instead written to its own file in a `<sha256(key)>/` folder and replaced by a
 * pointer in the JSON, so a value can carry large binaries (e.g. image bytes)
 * without base64-bloating it; `getItem` then returns those fields as lazy
 * {@link BlobRef}s (resolved on demand via {@link readBlobRef}), keeping metadata
 * reads cheap. Deleting a key removes its blob folder with it. Pointers already
 * on disk always decode, so flipping the flag never orphans existing entries.
 */
export class FileStorage implements Storage, SweepableStorage {
  private directory: string;
  private maxAge: number;
  private offloadBinary: boolean;

  constructor(options: FileStorageOptions) {
    assertNoPurgeInterval(options, 'FileStorage');
    this.directory = options.directory;
    this.maxAge = options.maxAge ?? 600_000;
    this.offloadBinary = options.offloadBinary ?? false;

    if (options.purgeOnInit) {
      rmSync(this.directory, { recursive: true, force: true });
    }
    mkdirSync(this.directory, { recursive: true });

    if (options.purge !== false) {
      registerSweepable(this);
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
    // Write the offloaded blobs first (each durable-write + rename), so a reader
    // that sees the JSON always sees the blobs it points at. Blob names are
    // content-addressed, so an identical file already on disk needs no rewrite.
    // Unlike Bun.write, `open` won't create `<hash>/`, so mkdir it once up front.
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
    // Write to a unique temp file (fsynced), then rename into place — rename is
    // atomic on the same filesystem, so a concurrent `getItem` never reads a
    // half-written file, and the fsync means a crash can't leave a torn file
    // either. fsync the directory so the rename itself survives a crash.
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
   * Plaintext keys of every persisted entry, read from each file's stored envelope
   * (filenames are `sha256(key)`, so the key can't be recovered from the name).
   * Reads every JSON file — intended for dev observability, not a hot path. Legacy
   * files without a stored key are skipped.
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
   * Delete files older than `maxAge`, reclaiming each entry's offloaded blob
   * folder with it, plus any orphaned blob folder whose owning JSON is gone.
   * Public so callers/tests can sweep on demand.
   *
   * `reportKeys` additionally returns each removed entry's plaintext key, read from
   * its envelope just before the unlink (filenames are `sha256(key)`, so the key is
   * not recoverable afterwards). That costs one extra read per *expired* entry, which
   * is why it's opt-in — but it lets a janitor attribute removals without calling
   * `keys()`, which reads every file in the directory. `.tmp` writes and corrupt or
   * legacy files carry no recoverable key, so they count toward `removed` without
   * appearing in `removedKeys`.
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
          // A `.tmp` is never a cache entry — only ever crash debris or a live
          // write's in-flight temp — so age it out by the crash-orphan grace, not
          // `maxAge`. With a tiny `maxAge` a slow write (Windows) would otherwise
          // let the sweep unlink a temp file mid-write, ENOENT-ing its own rename.
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

    // Pass 2: orphaned blob folders whose owning JSON no longer exists (already
    // reclaimed in pass 1, lost to a crash — or an in-flight first write whose
    // JSON hasn't landed yet, which the mtime grace below protects; a rename into
    // the folder refreshes its mtime). `rm` no-ops if gone.
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

  /** Detach from the shared sweep. Call when the cache is no longer needed (e.g. in tests). */
  dispose(): void {
    unregisterSweepable(this);
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

  // Deep-clone `value`, replacing binary fields with on-disk pointers and pushing
  // their bytes onto `blobs` to be written. Never mutates the input. An existing
  // BlobRef (e.g. re-persisted by `markStale`) is re-pointed at its existing blob
  // file without rewriting it. Fresh binaries are content-addressed by
  // `sha256(bytes)`, so a filename always implies its bytes: a rewrite writes a new
  // file rather than renaming new bytes over one a live lazy BlobRef still points
  // at, and identical bytes dedupe to one file. Superseded (now-unreferenced) blobs
  // are reclaimed with the whole entry folder by `removeItem`/the sweep.
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

  async sweepAndReport(): Promise<void> {
    const start = Date.now();
    try {
      const { removed } = await this.sweep(start);
      mochiEvents.emit('cache:sweep', { removed, durationMs: Date.now() - start });
    } catch (err) {
      logger.warn(`Cache sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
