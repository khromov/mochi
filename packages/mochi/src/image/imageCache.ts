import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { mochiEvents } from '../events';
import { extForFormat } from './resize';
import type { ImageFormat, ImageRequest } from './types';

// For the shared full-size original entry, `width`/`height` are 0 and `format`
// is '' (we don't decode originals); `contentType` is the authoritative type.
export interface SidecarMeta {
  v: 1;
  contentType: string;
  etag: string;
  width: number;
  height: number;
  format: string;
  createdAt: number;
  staleAt: number;
  evictAt: number;
  src: string;
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
}

function hash(input: string): string {
  return createHash('sha256').update(input).digest('base64url').slice(0, 22);
}

export function srcHash(src: string): string {
  return hash(src);
}

/** Identifies a variant by everything that affects the bytes — deliberately NOT the TTL. */
export function variantId(req: ImageRequest): string {
  const canonical = JSON.stringify({
    src: req.src,
    w: req.w ?? null,
    h: req.h ?? null,
    fit: req.fit,
    noUp: req.noUp ?? false,
    fmt: req.fmt,
    q: req.q,
    ao: req.ao,
  });
  return hash(canonical);
}

/** Identifies the full-size original entry for a source (the shared, un-resized cache). */
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

  constructor(private readonly root: string) {}

  private srcDir(src: string): string {
    return join(this.root, srcHash(src));
  }

  private basePath(req: ImageRequest): string {
    return join(this.srcDir(req.src), `${variantId(req)}.${extForFormat(req.fmt)}`);
  }

  private async readMeta(req: ImageRequest): Promise<SidecarMeta | null> {
    try {
      const raw = await readFile(`${this.basePath(req)}.json`, 'utf-8');
      return JSON.parse(raw) as SidecarMeta;
    } catch {
      return null;
    }
  }

  private async readBytes(req: ImageRequest): Promise<Uint8Array | null> {
    try {
      const buf = await readFile(this.basePath(req));
      return new Uint8Array(buf);
    } catch {
      return null;
    }
  }

  private async write(req: ImageRequest, bytes: Uint8Array, meta: SidecarMeta): Promise<void> {
    const base = this.basePath(req);
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

  private emitRead(req: ImageRequest, status: ImageCacheStatus): void {
    mochiEvents.emit('cache:read', { key: `image:${variantId(req)}`, status });
  }

  private revalidate(req: ImageRequest, regenerate: () => Promise<RegenResult>): Promise<CacheEntry> {
    const id = variantId(req);
    const existing = this.inflight.get(id);
    if (existing) {
      return existing;
    }

    const promise = (async (): Promise<CacheEntry> => {
      const r = await regenerate();
      const now = Date.now();
      const meta: SidecarMeta = {
        v: 1,
        contentType: r.contentType,
        etag: id,
        width: r.width,
        height: r.height,
        format: r.format,
        createdAt: now,
        staleAt: now + req.ts,
        evictAt: now + req.te,
        src: req.src,
      };
      await this.write(req, r.bytes, meta);
      return { bytes: r.bytes, meta };
    })().finally(() => this.inflight.delete(id));

    this.inflight.set(id, promise);
    return promise;
  }

  async get(req: ImageRequest, regenerate: () => Promise<RegenResult>): Promise<{ entry: CacheEntry; status: ImageCacheStatus }> {
    const meta = await this.readMeta(req);
    const now = Date.now();

    if (meta) {
      if (now < meta.staleAt) {
        const bytes = await this.readBytes(req);
        if (bytes) {
          this.emitRead(req, 'fresh');
          return { entry: { bytes, meta }, status: 'fresh' };
        }
      } else if (now < meta.evictAt) {
        const bytes = await this.readBytes(req);
        if (bytes) {
          this.emitRead(req, 'stale');
          mochiEvents.emit('cache:revalidate', { key: `image:${variantId(req)}` });
          void this.revalidate(req, regenerate).catch(() => {});
          return { entry: { bytes, meta }, status: 'stale' };
        }
      }
    }

    this.emitRead(req, 'miss');
    const entry = await this.revalidate(req, regenerate);
    return { entry, status: 'miss' };
  }

  private originalMetaPath(src: string): string {
    return join(this.srcDir(src), 'original.json');
  }

  private originalBytesPath(src: string, contentType: string): string {
    return join(this.srcDir(src), `original.${extForContentType(contentType)}`);
  }

  private async readOriginalMeta(src: string): Promise<SidecarMeta | null> {
    try {
      return JSON.parse(await readFile(this.originalMetaPath(src), 'utf-8')) as SidecarMeta;
    } catch {
      return null;
    }
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
   * variant. Same SWR semantics as `get()`, but keyed by `src` alone. `ts`/`te`
   * are the caller's desired window; because many callers share one entry the
   * SHORTEST requested window wins (see `shortenOriginalWindow`).
   */
  async getOriginal(
    src: string,
    ts: number,
    te: number,
    fetchFn: () => Promise<{ bytes: Uint8Array; contentType: string | null }>,
  ): Promise<{ entry: CacheEntry; status: ImageCacheStatus }> {
    const meta = await this.readOriginalMeta(src);
    const now = Date.now();

    if (meta) {
      if (now < meta.staleAt) {
        const bytes = await this.readOriginalBytes(src, meta.contentType);
        if (bytes) {
          this.emitOriginalRead(src, 'fresh');
          return { entry: { bytes, meta: await this.shortenOriginalWindow(src, meta, ts, te, now) }, status: 'fresh' };
        }
      } else if (now < meta.evictAt) {
        const bytes = await this.readOriginalBytes(src, meta.contentType);
        if (bytes) {
          this.emitOriginalRead(src, 'stale');
          mochiEvents.emit('cache:revalidate', { key: `image:${originalId(src)}` });
          void this.revalidateOriginal(src, ts, te, fetchFn).catch(() => {});
          return { entry: { bytes, meta: await this.shortenOriginalWindow(src, meta, ts, te, now) }, status: 'stale' };
        }
      }
    }

    this.emitOriginalRead(src, 'miss');
    const entry = await this.revalidateOriginal(src, ts, te, fetchFn);
    return { entry, status: 'miss' };
  }

  /**
   * Shorten the shared original entry's window to honour the strictest caller:
   * persist `min(existing, now + requested)`. Only writes the sidecar when a
   * value actually decreases, so the common case (everyone on the same default
   * window) stays a pure read.
   */
  private async shortenOriginalWindow(src: string, meta: SidecarMeta, ts: number, te: number, now: number): Promise<SidecarMeta> {
    const wantStaleAt = now + ts;
    const wantEvictAt = now + te;
    if (wantStaleAt >= meta.staleAt && wantEvictAt >= meta.evictAt) {
      return meta;
    }
    const next: SidecarMeta = {
      ...meta,
      staleAt: Math.min(meta.staleAt, wantStaleAt),
      evictAt: Math.min(meta.evictAt, wantEvictAt),
    };
    await this.writeMeta(this.originalMetaPath(src), next);
    return next;
  }

  private revalidateOriginal(src: string, ts: number, te: number, fetchFn: () => Promise<{ bytes: Uint8Array; contentType: string | null }>): Promise<CacheEntry> {
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
        v: 1,
        contentType,
        etag: originalId(src),
        width: 0,
        height: 0,
        format: '',
        createdAt: now,
        staleAt: now + ts,
        evictAt: now + te,
        src,
      };
      await this.writeBytesAndMeta(this.originalBytesPath(src, contentType), this.originalMetaPath(src), fetched.bytes, meta);
      return { bytes: fetched.bytes, meta };
    })().finally(() => this.inflight.delete(key));

    this.inflight.set(key, promise);
    return promise;
  }

  /** Remove every cached variant of a source — including the shared `original.*` entry. */
  async invalidateSrc(src: string): Promise<void> {
    await rm(this.srcDir(src), { recursive: true, force: true });
  }

  /** Remove a single variant (bytes + sidecar). */
  async invalidateVariant(req: ImageRequest): Promise<void> {
    const base = this.basePath(req);
    await Promise.all([
      unlink(base).catch((e) => {
        if (!isMissingFileError(e)) {
          throw e;
        }
      }),
      unlink(`${base}.json`).catch((e) => {
        if (!isMissingFileError(e)) {
          throw e;
        }
      }),
    ]);
  }

  private placeholderPath(src: string): string {
    return join(this.srcDir(src), 'placeholder.txt');
  }

  async getPlaceholder(src: string): Promise<string | null> {
    try {
      return await readFile(this.placeholderPath(src), 'utf-8');
    } catch {
      return null;
    }
  }

  async setPlaceholder(src: string, dataUrl: string): Promise<void> {
    await mkdir(this.srcDir(src), { recursive: true });
    const path = this.placeholderPath(src);
    await writeFile(`${path}.tmp`, dataUrl);
    await rename(`${path}.tmp`, path);
  }
}
