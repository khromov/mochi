import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { hasSubscribers, mochiEvents, type MochiImageEntryKind } from '../events';
import { extForFormat } from './resize';
import type { ImageFormat, ImageRequest } from './types';

// For the shared full-size original entry, `width`/`height` are 0 and `format`
// is '' (we don't decode originals); `contentType` is the authoritative type.
export interface SidecarMeta {
  version: 1;
  contentType: string;
  etag: string;
  width: number;
  height: number;
  format: string;
  createdAt: number;
  staleAt: number;
  evictAt: number;
  src: string;
  // Variants only: the original's `createdAt` this variant was resized from. A
  // variant's freshness/eviction is read from the original's sidecar at request
  // time; this marks which original generation produced these bytes.
  originalCreatedAt?: number;
}

export interface CacheEntry {
  bytes: Uint8Array;
  meta: SidecarMeta;
}

export type ImageCacheStatus = 'fresh' | 'stale' | 'miss';

/** Result returned by the regenerate callback (timestamps/etag added by the cache). */
export interface RegenResult {
  bytes: Uint8Array;
  contentType: string;
  width: number;
  height: number;
  format: ImageFormat;
  // The original generation (`createdAt`) the bytes were derived from. Must be
  // reported by the callback rather than re-read after it returns: a background
  // original refresh can land mid-regeneration, and stamping the new generation
  // onto bytes resized from the old one would serve stale content as fresh.
  originalCreatedAt?: number;
}

function hash(input: string): string {
  return createHash('sha256').update(input).digest('base64url').slice(0, 22);
}

export function srcHash(src: string): string {
  return hash(src);
}

// Recursively sort object keys so an op descriptor hashes the same regardless of
// the order the caller wrote the option properties. Arrays keep their order (a
// transform chain is order-sensitive).
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonicalize((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** Stable variant id for an arbitrary (non-`ImageRequest`) transform descriptor. */
export function pipelineVariantId(descriptor: unknown): string {
  return hash(JSON.stringify(canonicalize(descriptor)));
}

/** Identifies a variant by everything that affects the bytes — deliberately NOT the TTL. */
export function variantId(req: ImageRequest): string {
  const canonical = JSON.stringify({
    src: req.src,
    width: req.width ?? null,
    height: req.height ?? null,
    fit: req.fit,
    withoutEnlargement: req.withoutEnlargement ?? false,
    format: req.format,
    quality: req.quality,
    autoOrient: req.autoOrient,
  });
  return hash(canonical);
}

export function originalId(src: string): string {
  return hash(`original:${src}`);
}

const EXT_FOR_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

/** Cosmetic on-disk extension for an original's content-type; the sidecar holds the authoritative type. */
function extForContentType(ct: string): string {
  return EXT_FOR_CONTENT_TYPE[ct.split(';')[0]!.trim().toLowerCase()] ?? 'bin';
}

function isMissingFileError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT');
}

/**
 * Disk-backed image cache with stale-while-revalidate semantics. Both the
 * encoded bytes and the SWR timing metadata live on disk, so timers survive a
 * restart. Concurrent misses (and background revalidations) for the same
 * variant are coalesced through `inflight`.
 */
export class ImageCache {
  private inflight = new Map<string, Promise<CacheEntry>>();
  private originalMetaLocks = new Map<string, Promise<unknown>>();

  constructor(private readonly root: string) {}

  // Serialize read-modify-write cycles on a source's original sidecar:
  // `shortenOriginalWindow` and `invalidateOriginal` both re-read inside the
  // lock, so neither can clobber the other's write with a stale snapshot
  // (e.g. resurrecting a hard-invalidated entry).
  private withOriginalMetaLock<T>(src: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.originalMetaLocks.get(src) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.originalMetaLocks.set(src, tail);
    void tail.then(() => {
      if (this.originalMetaLocks.get(src) === tail) {
        this.originalMetaLocks.delete(src);
      }
    });
    return run;
  }

  private srcDir(src: string): string {
    return join(this.root, srcHash(src));
  }

  private basePathFor(src: string, id: string, ext: string): string {
    return join(this.srcDir(src), `${id}.${ext}`);
  }

  private async readMetaFor(src: string, id: string, ext: string): Promise<SidecarMeta | null> {
    try {
      const raw = await readFile(`${this.basePathFor(src, id, ext)}.json`, 'utf-8');
      return JSON.parse(raw) as SidecarMeta;
    } catch {
      return null;
    }
  }

  private async readBytesFor(src: string, id: string, ext: string): Promise<Uint8Array | null> {
    try {
      const buf = await readFile(this.basePathFor(src, id, ext));
      return new Uint8Array(buf);
    } catch {
      return null;
    }
  }

  private async writeFor(src: string, id: string, ext: string, bytes: Uint8Array, meta: SidecarMeta): Promise<void> {
    const base = this.basePathFor(src, id, ext);
    await this.writeBytesAndMeta(base, `${base}.json`, bytes, meta);
  }

  // Write bytes first, sidecar last: the sidecar's presence marks the entry valid.
  private async writeBytesAndMeta(bytesPath: string, metaPath: string, bytes: Uint8Array, meta: SidecarMeta): Promise<void> {
    await mkdir(dirname(bytesPath), { recursive: true });
    await writeFile(`${bytesPath}.tmp`, bytes);
    await rename(`${bytesPath}.tmp`, bytesPath);
    await this.writeMeta(metaPath, meta);
  }

  private async writeMeta(metaPath: string, meta: SidecarMeta): Promise<void> {
    await writeFile(`${metaPath}.tmp`, JSON.stringify(meta));
    await rename(`${metaPath}.tmp`, metaPath);
  }

  private emitReadFor(id: string, status: ImageCacheStatus): void {
    mochiEvents.emit('cache:read', { key: `image:${id}`, status });
  }

  private revalidateFor(src: string, id: string, ext: string, regenerate: () => Promise<RegenResult>): Promise<CacheEntry> {
    const existing = this.inflight.get(id);
    if (existing) {
      return existing;
    }

    const promise = (async (): Promise<CacheEntry> => {
      const r = await regenerate();
      // The variant inherits the original's SWR window. The generation stamp
      // prefers the callback's report (the generation of the bytes actually
      // used) over the sidecar re-read, which may already be a newer generation.
      const om = await this.readOriginalMeta(src);
      const now = Date.now();
      const meta: SidecarMeta = {
        version: 1,
        contentType: r.contentType,
        etag: id,
        width: r.width,
        height: r.height,
        format: r.format,
        createdAt: now,
        staleAt: om?.staleAt ?? now,
        evictAt: om?.evictAt ?? now,
        src,
        originalCreatedAt: r.originalCreatedAt ?? om?.createdAt,
      };
      await this.writeFor(src, id, ext, r.bytes, meta);
      mochiEvents.emit('image:store', {
        kind: 'variant',
        src,
        path: this.basePathFor(src, id, ext),
        id,
        size: r.bytes.byteLength,
        contentType: r.contentType,
        width: r.width,
        height: r.height,
        format: r.format,
      });
      return { bytes: r.bytes, meta };
    })().finally(() => this.inflight.delete(id));

    this.inflight.set(id, promise);
    return promise;
  }

  /**
   * Read a cached variant keyed by an arbitrary id (a resize `variantId`, or a
   * `pipelineVariantId` for the raw `Bun.Image` wrapper). A variant has no window
   * of its own — its fresh/stale/evicted state is derived from the shared
   * original's sidecar. `originalCreatedAt` marks which original generation
   * produced these bytes, so a refreshed original (bumped `createdAt`) serves the
   * old variant stale while it regenerates. The variant disappears when the
   * original is evicted.
   */
  async getVariant(src: string, id: string, ext: string, regenerate: () => Promise<RegenResult>): Promise<{ entry: CacheEntry; status: ImageCacheStatus }> {
    const meta = await this.readMetaFor(src, id, ext);
    const orig = await this.readOriginalMeta(src);
    const now = Date.now();

    if (meta && orig) {
      const sameGen = meta.originalCreatedAt === orig.createdAt;
      if (sameGen && now < orig.staleAt) {
        const bytes = await this.readBytesFor(src, id, ext);
        if (bytes) {
          this.emitReadFor(id, 'fresh');
          return { entry: { bytes, meta }, status: 'fresh' };
        }
      } else if (now < orig.evictAt) {
        // Stale window, or the original was refreshed to a newer generation:
        // serve the existing variant immediately and regenerate in the background.
        const bytes = await this.readBytesFor(src, id, ext);
        if (bytes) {
          this.emitReadFor(id, 'stale');
          mochiEvents.emit('cache:revalidate', { key: `image:${id}` });
          void this.revalidateFor(src, id, ext, regenerate).catch(() => {});
          return { entry: { bytes, meta }, status: 'stale' };
        }
      }
    }

    this.emitReadFor(id, 'miss');
    const entry = await this.revalidateFor(src, id, ext, regenerate);
    return { entry, status: 'miss' };
  }

  /** Resize-variant read: derives the id/ext from the `ImageRequest`. */
  get(req: ImageRequest, regenerate: () => Promise<RegenResult>): Promise<{ entry: CacheEntry; status: ImageCacheStatus }> {
    return this.getVariant(req.src, variantId(req), extForFormat(req.format), regenerate);
  }

  private originalMetaPath(src: string): string {
    return join(this.srcDir(src), 'original.json');
  }

  private originalBytesPath(src: string, contentType: string): string {
    return join(this.srcDir(src), `original.${extForContentType(contentType)}`);
  }

  private async readOriginalMeta(src: string): Promise<SidecarMeta | null> {
    return this.readMetaAt(this.originalMetaPath(src));
  }

  private async readMetaAt(path: string): Promise<SidecarMeta | null> {
    try {
      return JSON.parse(await readFile(path, 'utf-8')) as SidecarMeta;
    } catch {
      return null;
    }
  }

  private async removeFile(path: string): Promise<number> {
    try {
      const { size } = await stat(path);
      await unlink(path);
      return size;
    } catch {
      return 0;
    }
  }

  // Best-effort delete of `original.<ext>` bytes whose extension isn't `keepExt`
  // (and never the `original.json` sidecar) — used to reclaim a previous
  // generation's bytes when the source's content-type changed.
  private async removeStaleOriginalBytes(src: string, keepExt: string): Promise<void> {
    const dir = this.srcDir(src);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return;
    }
    await Promise.all(
      files
        .filter((f) => f.startsWith('original.') && f !== 'original.json' && f !== `original.${keepExt}`)
        .map(async (f) => {
          const path = join(dir, f);
          const freed = await this.removeFile(path);
          if (freed > 0) {
            mochiEvents.emit('image:delete', { kind: 'original', src, path, id: originalId(src), size: freed, reason: 'superseded' });
          }
        }),
    );
  }

  private async readOriginalBytes(src: string, contentType: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.originalBytesPath(src, contentType)));
    } catch {
      return null;
    }
  }

  private emitOriginalRead(src: string, status: ImageCacheStatus): void {
    mochiEvents.emit('cache:read', { key: `image:${originalId(src)}`, status });
  }

  /**
   * Get-or-fetch the full-size original bytes for a source, shared across every
   * variant. Same SWR semantics as `get()`, but keyed by `src` alone.
   * `timeToStale`/`timeToEvict` are the caller's desired window; because many
   * callers share one entry the SHORTEST requested window wins (see
   * `shortenOriginalWindow`).
   */
  async getOriginal(
    src: string,
    timeToStale: number,
    timeToEvict: number,
    fetchFn: () => Promise<{ bytes: Uint8Array; contentType: string | null }>,
  ): Promise<{ entry: CacheEntry; status: ImageCacheStatus }> {
    const meta = await this.readOriginalMeta(src);
    const now = Date.now();

    if (meta) {
      if (now < meta.staleAt) {
        const bytes = await this.readOriginalBytes(src, meta.contentType);
        if (bytes) {
          this.emitOriginalRead(src, 'fresh');
          return { entry: { bytes, meta: await this.shortenOriginalWindow(src, meta, timeToStale, timeToEvict, now) }, status: 'fresh' };
        }
      } else if (now < meta.evictAt) {
        const bytes = await this.readOriginalBytes(src, meta.contentType);
        if (bytes) {
          this.emitOriginalRead(src, 'stale');
          mochiEvents.emit('cache:revalidate', { key: `image:${originalId(src)}` });
          void this.revalidateOriginal(src, timeToStale, timeToEvict, fetchFn).catch(() => {});
          return { entry: { bytes, meta: await this.shortenOriginalWindow(src, meta, timeToStale, timeToEvict, now) }, status: 'stale' };
        }
      }
    }

    this.emitOriginalRead(src, 'miss');
    const entry = await this.revalidateOriginal(src, timeToStale, timeToEvict, fetchFn);
    return { entry, status: 'miss' };
  }

  /**
   * Shorten the shared original entry's window to honour the strictest caller:
   * persist `min(existing, now + requested)`. Only writes the sidecar when a
   * value actually decreases, so the common case (everyone on the same default
   * window) stays a pure read.
   */
  private async shortenOriginalWindow(src: string, meta: SidecarMeta, timeToStale: number, timeToEvict: number, now: number): Promise<SidecarMeta> {
    const wantStaleAt = now + timeToStale;
    const wantEvictAt = now + timeToEvict;
    if (wantStaleAt >= meta.staleAt && wantEvictAt >= meta.evictAt) {
      return meta;
    }
    return this.withOriginalMetaLock(src, async () => {
      // Min against the current on-disk sidecar, not the caller's snapshot — a
      // concurrent invalidate may have shortened the window since it was read.
      const current = (await this.readOriginalMeta(src)) ?? meta;
      const next: SidecarMeta = {
        ...current,
        staleAt: Math.min(current.staleAt, wantStaleAt),
        evictAt: Math.min(current.evictAt, wantEvictAt),
      };
      if (next.staleAt !== current.staleAt || next.evictAt !== current.evictAt) {
        await this.writeMeta(this.originalMetaPath(src), next);
      }
      return next;
    });
  }

  private revalidateOriginal(
    src: string,
    timeToStale: number,
    timeToEvict: number,
    fetchFn: () => Promise<{ bytes: Uint8Array; contentType: string | null }>,
  ): Promise<CacheEntry> {
    // `o:`-prefixed key: a colon can't appear in a base64url variantId, so this
    // never collides with the resize-variant inflight entries.
    const key = `o:${originalId(src)}`;
    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }

    const promise = (async (): Promise<CacheEntry> => {
      const fetched = await fetchFn();
      const contentType = fetched.contentType ?? 'application/octet-stream';
      const now = Date.now();
      const meta: SidecarMeta = {
        version: 1,
        contentType,
        etag: originalId(src),
        width: 0,
        height: 0,
        format: '',
        createdAt: now,
        staleAt: now + timeToStale,
        evictAt: now + timeToEvict,
        src,
      };
      await this.writeBytesAndMeta(this.originalBytesPath(src, contentType), this.originalMetaPath(src), fetched.bytes, meta);
      // The origin may switch formats between generations (png → webp), which
      // changes the `original.<ext>` filename; drop any bytes left under the old
      // extension so they don't linger until the next sweep.
      await this.removeStaleOriginalBytes(src, extForContentType(contentType));
      mochiEvents.emit('image:store', {
        kind: 'original',
        src,
        path: this.originalBytesPath(src, contentType),
        id: originalId(src),
        size: fetched.bytes.byteLength,
        contentType,
        width: 0,
        height: 0,
        format: '',
      });
      return { bytes: fetched.bytes, meta };
    })().finally(() => this.inflight.delete(key));

    this.inflight.set(key, promise);
    return promise;
  }

  async invalidateSrc(src: string): Promise<void> {
    const dir = this.srcDir(src);
    // Bulk `rm -rf` can't enumerate what it deleted, so per-file delete events
    // are only constructible by first reading the directory. Do that solely when
    // someone is listening — otherwise stay a plain, fast recursive remove.
    if (hasSubscribers('image:delete')) {
      await this.emitSrcDirDeletes(src, dir);
    }
    await rm(dir, { recursive: true, force: true });
  }

  private async emitSrcDirDeletes(src: string, dir: string): Promise<void> {
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return;
    }
    for (const f of files) {
      // Sidecars/temp files aren't independent entries — skip them.
      if (f.endsWith('.json') || f.endsWith('.tmp')) {
        continue;
      }
      let kind: MochiImageEntryKind;
      let id: string;
      if (f === 'placeholder.txt') {
        kind = 'placeholder';
        id = originalId(src);
      } else if (f.startsWith('original.')) {
        kind = 'original';
        id = originalId(src);
      } else {
        kind = 'variant';
        id = f.slice(0, f.lastIndexOf('.'));
      }
      const path = join(dir, f);
      let size = 0;
      try {
        size = (await stat(path)).size;
      } catch {
        // best-effort; the file may vanish between readdir and stat
      }
      mochiEvents.emit('image:delete', { kind, src, path, id, size, reason: 'invalidated' });
    }
  }

  /**
   * Immediately invalidate a source by rewriting the shared original's SWR
   * timers; every variant follows the original, so this cascades. `hard: false`
   * marks it stale (served stale-while-revalidate); `hard: true` also marks it
   * expired (the next request re-fetches synchronously). No-op if nothing is cached.
   */
  async invalidateOriginal(src: string, hard: boolean): Promise<void> {
    await this.withOriginalMetaLock(src, async () => {
      const meta = await this.readOriginalMeta(src);
      if (!meta) {
        return;
      }
      const now = Date.now();
      await this.writeMeta(this.originalMetaPath(src), {
        ...meta,
        staleAt: Math.min(meta.staleAt, now),
        evictAt: hard ? Math.min(meta.evictAt, now) : meta.evictAt,
      });
    });
  }

  async invalidateVariant(req: ImageRequest): Promise<void> {
    await this.invalidateVariantById(req.src, variantId(req), extForFormat(req.format));
  }

  async invalidateVariantById(src: string, id: string, ext: string): Promise<void> {
    const base = this.basePathFor(src, id, ext);
    const [freed] = await Promise.all([
      this.removeFile(base),
      unlink(`${base}.json`).catch((e) => {
        if (!isMissingFileError(e)) {
          throw e;
        }
      }),
    ]);
    if (freed > 0) {
      mochiEvents.emit('image:delete', { kind: 'variant', src, path: base, id, size: freed, reason: 'invalidated' });
    }
  }

  /**
   * Janitor sweep: walk the cache root and delete entries that can no longer be
   * served — full-size originals past their evict window, and variants (and the
   * placeholder) whose original is gone, evicted, or superseded by a newer
   * generation. Variant freshness already derives from the original at request
   * time, so this only reclaims dead disk; it never changes what a live request
   * would see.
   */
  async sweep(now: number = Date.now()): Promise<{ removedVariants: number; removedOriginals: number; freedBytes: number }> {
    let removedVariants = 0;
    let removedOriginals = 0;
    let freedBytes = 0;

    let dirs;
    try {
      dirs = await readdir(this.root, { withFileTypes: true });
    } catch {
      return { removedVariants, removedOriginals, freedBytes }; // cache dir not created yet
    }

    for (const d of dirs) {
      if (!d.isDirectory()) {
        continue;
      }
      const dir = join(this.root, d.name);
      const orig = await this.readMetaAt(join(dir, 'original.json'));
      const origDead = orig === null || now >= orig.evictAt;

      let files: string[];
      try {
        files = await readdir(dir);
      } catch {
        continue;
      }

      for (const f of files) {
        // Variants are decided by their sidecar; originals and the placeholder are handled separately.
        if (!f.endsWith('.json') || f === 'original.json') {
          continue;
        }
        const meta = await this.readMetaAt(join(dir, f));
        const superseded = orig !== null && meta !== null && meta.originalCreatedAt !== orig.createdAt;
        if (origDead || superseded) {
          const bytesPath = join(dir, f.slice(0, -'.json'.length));
          const freed = (await this.removeFile(bytesPath)) + (await this.removeFile(join(dir, f))); // bytes + sidecar
          freedBytes += freed;
          removedVariants++;
          mochiEvents.emit('image:delete', {
            kind: 'variant',
            src: meta?.src ?? '',
            path: bytesPath,
            id: meta?.etag ?? f.slice(0, f.lastIndexOf('.')),
            size: freed,
            reason: origDead ? 'evicted' : 'superseded',
          });
        }
      }

      if (orig !== null && origDead) {
        // Remove every `original.*` (bytes of any extension + the sidecar) so a
        // stale-format leftover from a content-type change is reclaimed too.
        let freed = 0;
        for (const f of files) {
          if (f.startsWith('original.')) {
            freed += await this.removeFile(join(dir, f));
          }
        }
        freedBytes += freed;
        removedOriginals++;
        mochiEvents.emit('image:delete', {
          kind: 'original',
          src: orig.src,
          path: this.originalBytesPath(orig.src, orig.contentType),
          id: originalId(orig.src),
          size: freed,
          reason: 'evicted',
        });
      }

      // The placeholder is bound to the original's generation, so it's dead
      // disk once the original is gone — and leaving it would keep the src
      // directory from ever being reclaimed below.
      if (origDead && files.includes('placeholder.txt')) {
        const placeholderPath = join(dir, 'placeholder.txt');
        const freed = await this.removeFile(placeholderPath);
        freedBytes += freed;
        if (orig !== null) {
          mochiEvents.emit('image:delete', {
            kind: 'placeholder',
            src: orig.src,
            path: placeholderPath,
            id: originalId(orig.src),
            size: freed,
            reason: 'evicted',
          });
        }
      }

      // Reclaim the src directory once the sweep has emptied it (no variants,
      // original, or placeholder remain).
      try {
        if ((await readdir(dir)).length === 0) {
          await rmdir(dir);
        }
      } catch {
        // best-effort
      }
    }

    return { removedVariants, removedOriginals, freedBytes };
  }

  private placeholderPath(src: string): string {
    return join(this.srcDir(src), 'placeholder.txt');
  }

  /**
   * Placeholders have no window of their own; like variants, they're bound to
   * the original generation they were computed from, so an invalidated or
   * re-fetched original makes the next read a miss (recompute) instead of
   * serving the previous image's blur forever.
   */
  async getPlaceholder(src: string): Promise<string | null> {
    try {
      const raw = await readFile(this.placeholderPath(src), 'utf-8');
      const stored = JSON.parse(raw) as { dataUrl: string; originalCreatedAt: number };
      const orig = await this.readOriginalMeta(src);
      if (!orig || orig.createdAt !== stored.originalCreatedAt) {
        return null;
      }
      return stored.dataUrl;
    } catch {
      return null;
    }
  }

  async setPlaceholder(src: string, dataUrl: string, originalCreatedAt: number): Promise<void> {
    await mkdir(this.srcDir(src), { recursive: true });
    const path = this.placeholderPath(src);
    const json = JSON.stringify({ dataUrl, originalCreatedAt });
    await writeFile(`${path}.tmp`, json);
    await rename(`${path}.tmp`, path);
    mochiEvents.emit('image:store', {
      kind: 'placeholder',
      src,
      path,
      id: originalId(src),
      size: Buffer.byteLength(json),
      contentType: '',
      width: 0,
      height: 0,
      format: '',
    });
  }
}
