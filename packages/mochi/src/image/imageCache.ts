import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mochiEvents } from '../events';
import { extForFormat } from './resize';
import type { ImageFormat, ImageRequest } from './types';

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
    await mkdir(this.srcDir(req.src), { recursive: true });
    const base = this.basePath(req);
    // Write bytes first, sidecar last: the sidecar's presence marks the entry valid.
    await writeFile(`${base}.tmp`, bytes);
    await rename(`${base}.tmp`, base);
    await writeFile(`${base}.json.tmp`, JSON.stringify(meta));
    await rename(`${base}.json.tmp`, `${base}.json`);
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

  /** Remove every cached variant of a source. */
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
