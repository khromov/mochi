import { createHash } from 'node:crypto';
import type { CacheStatus } from '../cache';
import { MochiCache } from '../cache';
import { FileStorage, isBlobRef, readBlobRef, type BlobRef } from '../cache-storage';
import { mochiEvents, type MochiImageDeleteReason } from '../events';
import type { ImageFormat, ResolvedImageSize } from './types';

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
  // TODO: restore generation stamping. Kept optional for return-shape
  // compatibility; no longer written (variants mirror the original by status).
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
  // TODO: restore generation stamping. Currently ignored — variants mirror the
  // original's live status instead of stamping the generation they came from.
  originalCreatedAt?: number;
}

function hash(input: string): string {
  return createHash('sha256').update(input).digest('base64url').slice(0, 22);
}

export function srcHash(src: string): string {
  return hash(src);
}

/**
 * Identifies a variant by its source and the size's config hash. The config
 * hash already folds in every byte-affecting field (dims, ops, format, quality),
 * so a size redefinition changes the id — a new cache entry and ETag — while
 * two sizes with identical config correctly share one entry. Deliberately NOT
 * keyed by the TTLs.
 */
export function variantId(src: string, configHash: string): string {
  return hash(`variant:${configHash}:${src}`);
}

export function originalId(src: string): string {
  return hash(`original:${src}`);
}

// Cache-key convention. The prefixes are distinct, so the `cache:delete` cascade
// hook can recover a source from an original key; variant keys are constructed
// from (src, configHash) and never need to be parsed back.
const ORIG_PREFIX = 'img:orig:';
const VAR_PREFIX = 'img:var:';
const PH_PREFIX = 'img:ph:';
const origKey = (src: string): string => ORIG_PREFIX + src;
const varKey = (id: string): string => VAR_PREFIX + id;
const phKey = (src: string): string => PH_PREFIX + src;

// MochiCache reports a synchronous recompute as 'expired'; the image status set
// folds that into 'miss' (both mean "regenerated on this request").
function mapStatus(status: CacheStatus): ImageCacheStatus {
  if (status === 'expired' || status === 'miss') {
    return 'miss';
  }
  return status;
}

// Byte length of a stored payload, whether it's still in memory (fresh compute)
// or offloaded to a blob (a FileStorage read returns a BlobRef carrying its size).
function storedBytesLen(bytes: Uint8Array | BlobRef): number {
  return isBlobRef(bytes) ? bytes.bytes : bytes.byteLength;
}

// The stored cache value for an original/variant: metadata plus the encoded bytes.
// FileStorage offloads `bytes` to a blob file and returns it as a lazy `BlobRef`
// on a cache hit, so reading the metadata never loads the bytes.
interface StoredImage {
  createdAt: number;
  contentType: string;
  etag: string;
  width: number;
  height: number;
  format: string;
  bytes: Uint8Array | BlobRef;
}

interface StoredPlaceholder {
  dataUrl: string;
}

export interface ImageCacheOptions {
  cacheDir: string;
  /** One global stale-while-revalidate window shared by every entry. */
  minTimeToStale: number;
  maxTimeToLive: number;
  /** Configured named sizes — the cascade deletes each source's variants by these. */
  sizes: Record<string, ResolvedImageSize>;
}

/**
 * Image cache backed by {@link MochiCache} over {@link FileStorage}. Originals,
 * resized variants, and blur placeholders are each a cache entry under the
 * `img:orig:` / `img:var:` / `img:ph:` key convention; the SWR window, request
 * coalescing, and binary persistence all come from the shared cache primitives.
 *
 * A variant has no window of its own — its served freshness mirrors the shared
 * original's status at request time. Hard invalidation deletes the original key,
 * whose `cache:delete` event cascades to the source's variants and placeholder;
 * everything else is reclaimed by the age-based sweep.
 */
export class ImageCache {
  private readonly storage: FileStorage;
  private readonly cache: MochiCache;
  private readonly minTimeToStale: number;
  private readonly maxTimeToLive: number;
  private readonly sizes: Record<string, ResolvedImageSize>;

  constructor(options: ImageCacheOptions) {
    this.minTimeToStale = options.minTimeToStale;
    this.maxTimeToLive = options.maxTimeToLive;
    this.sizes = options.sizes;
    // FileStorage's own age-sweeper is disabled; the image sweeper (`sweeper.ts`)
    // drives `sweep()`. `maxAge >= maxTimeToLive`, so it never drops a servable entry.
    this.storage = new FileStorage({ directory: options.cacheDir, maxAge: options.maxTimeToLive, purgeInterval: 0 });
    // 60s in-flight timeout: an image regen (fetch upstream → decode → resize)
    // should never hold the per-key coalescing lock for long, so a hung upstream
    // fails fast instead of parking every waiter until the far larger default.
    this.cache = new MochiCache({ minTimeToStale: this.minTimeToStale, maxTimeToLive: this.maxTimeToLive, storage: this.storage, inflightTimeout: 60_000 });
    // Cascade: deleting a source's original key reclaims its variants + placeholder.
    // `setHandler` (not `.on`) so a dev re-import replaces rather than stacks the sub.
    mochiEvents.setHandler('mochi-image:cache-delete', 'cache:delete', (event) => {
      if (event.key.startsWith(ORIG_PREFIX)) {
        void this.cascadeSource(event.key.slice(ORIG_PREFIX.length), 'invalidated').catch(() => {});
      }
    });
  }

  private async toBytes(field: Uint8Array | BlobRef): Promise<Uint8Array> {
    return isBlobRef(field) ? readBlobRef(field) : field;
  }

  private metaFrom(src: string, value: StoredImage): SidecarMeta {
    return {
      version: 1,
      contentType: value.contentType,
      etag: value.etag,
      width: value.width,
      height: value.height,
      format: value.format,
      createdAt: value.createdAt,
      staleAt: value.createdAt + this.minTimeToStale,
      evictAt: value.createdAt + this.maxTimeToLive,
      src,
    };
  }

  /**
   * Read a cached variant keyed by its `variantId` (source + size config hash).
   * A variant has no window of its own: its fresh/stale/miss state mirrors the
   * shared original's status. Probing the original uses a lazy blob ref, so a
   * fresh variant serve never loads the original's bytes.
   */
  async getVariant(src: string, id: string, _ext: string, regenerate: () => Promise<RegenResult>): Promise<{ entry: CacheEntry; status: ImageCacheStatus }> {
    const key = varKey(id);
    const orig = await this.cache.peek<StoredImage>(origKey(src));
    if (!orig || orig.status === 'expired') {
      // Original gone or past its window → force a fresh regen against the refreshed original.
      await this.cache.delete(key);
    } else if (orig.status === 'stale') {
      await this.cache.markStale(key);
    }

    const { value, status } = await this.cache.fetchWithStatus<StoredImage>(key, async () => {
      const r = await regenerate();
      const stored: StoredImage = {
        createdAt: Date.now(),
        contentType: r.contentType,
        etag: id,
        width: r.width,
        height: r.height,
        format: r.format,
        bytes: r.bytes,
      };
      mochiEvents.emit('image:store', {
        kind: 'variant',
        src,
        path: this.storage.pathForKey(key),
        id,
        size: r.bytes.byteLength,
        contentType: r.contentType,
        width: r.width,
        height: r.height,
        format: r.format,
      });
      return stored;
    });

    const bytes = await this.toBytes(value.bytes);
    return { entry: { bytes, meta: this.metaFrom(src, value) }, status: mapStatus(status) };
  }

  /**
   * Get-or-fetch the full-size original bytes for a source, shared across every
   * variant and keyed by `src` alone. `timeToStale`/`timeToEvict` are ignored —
   * TODO: restore per-request/shortest-wins TTLs; every entry currently shares
   * one global window.
   */
  async getOriginal(
    src: string,
    _timeToStale: number,
    _timeToEvict: number,
    fetchFn: () => Promise<{ bytes: Uint8Array; contentType: string | null }>,
  ): Promise<{ entry: CacheEntry; status: ImageCacheStatus }> {
    const key = origKey(src);
    const { value, status } = await this.cache.fetchWithStatus<StoredImage>(key, async () => {
      const fetched = await fetchFn();
      const contentType = fetched.contentType ?? 'application/octet-stream';
      const stored: StoredImage = {
        createdAt: Date.now(),
        contentType,
        etag: originalId(src),
        width: 0,
        height: 0,
        format: '',
        bytes: fetched.bytes,
      };
      mochiEvents.emit('image:store', {
        kind: 'original',
        src,
        path: this.storage.pathForKey(key),
        id: originalId(src),
        size: fetched.bytes.byteLength,
        contentType,
        width: 0,
        height: 0,
        format: '',
      });
      return stored;
    });

    const bytes = await this.toBytes(value.bytes);
    return { entry: { bytes, meta: this.metaFrom(src, value) }, status: mapStatus(status) };
  }

  /**
   * Immediately invalidate a source. `hard` deletes the original key — its
   * `cache:delete` cascades to every variant and the placeholder; `soft` marks
   * the original stale so the variant mirror serves stale-while-revalidate. No-op
   * if nothing is cached.
   */
  async invalidateOriginal(src: string, hard: boolean): Promise<void> {
    const key = origKey(src);
    if (!hard) {
      await this.cache.markStale(key);
      return;
    }
    // Peek the original for its size before deleting. Cascade first, then drop the
    // original — the delete re-fires the cascade hook, which finds nothing left (a
    // harmless no-op), so there's no double emit.
    const orig = await this.cache.peek<StoredImage>(key);
    await this.cascadeSource(src, 'invalidated');
    await this.cache.delete(key);
    if (orig) {
      mochiEvents.emit('image:delete', {
        kind: 'original',
        src,
        path: this.storage.pathForKey(key),
        id: originalId(src),
        size: storedBytesLen(orig.value.bytes),
        reason: 'invalidated',
      });
    }
  }

  // Delete a source's placeholder and every configured size's variant, emitting an
  // `image:delete` per entry that actually existed. Idempotent: a second run finds
  // nothing and emits nothing. TODO: reclaim ad-hoc inline variants (config hashes
  // not in `sizes`) too — they currently fall to the age-based sweep.
  private async cascadeSource(src: string, reason: MochiImageDeleteReason): Promise<void> {
    const ph = await this.cache.peek<StoredPlaceholder>(phKey(src));
    if (ph) {
      await this.cache.delete(phKey(src));
      mochiEvents.emit('image:delete', {
        kind: 'placeholder',
        src,
        path: this.storage.pathForKey(phKey(src)),
        id: originalId(src),
        size: Buffer.byteLength(ph.value.dataUrl),
        reason,
      });
    }
    for (const size of Object.values(this.sizes)) {
      const id = variantId(src, size.configHash);
      const variant = await this.cache.peek<StoredImage>(varKey(id));
      if (variant) {
        await this.cache.delete(varKey(id));
        mochiEvents.emit('image:delete', {
          kind: 'variant',
          src,
          path: this.storage.pathForKey(varKey(id)),
          id,
          size: storedBytesLen(variant.value.bytes),
          reason,
        });
      }
    }
  }

  /**
   * Janitor sweep: reclaim entries past the global window. Delegates to
   * FileStorage's age-based sweep. TODO: restore precise per-kind counts — the
   * flat keyspace can't distinguish originals from variants, so everything
   * reclaimed is reported under `removedVariants`.
   */
  async sweep(now: number = Date.now()): Promise<{ removedVariants: number; removedOriginals: number; freedBytes: number }> {
    const { removed, freedBytes } = await this.storage.sweep(now);
    return { removedVariants: removed, removedOriginals: 0, freedBytes };
  }

  /**
   * Placeholders have no window of their own; served until their global window
   * lapses or the invalidation cascade removes them. TODO: restore generation
   * gating so a re-fetched original invalidates the placeholder precisely.
   */
  async getPlaceholder(src: string): Promise<string | null> {
    const cached = await this.cache.peek<StoredPlaceholder>(phKey(src));
    if (!cached || cached.status === 'expired') {
      return null;
    }
    return cached.value.dataUrl;
  }

  async setPlaceholder(src: string, dataUrl: string, _originalCreatedAt: number): Promise<void> {
    const key = phKey(src);
    // Overwrite unconditionally: a plain `fetch` would skip the write if a stale
    // entry were still present. Only called on a miss/expired in practice.
    await this.cache.delete(key);
    await this.cache.fetch<StoredPlaceholder>(key, () => {
      mochiEvents.emit('image:store', {
        kind: 'placeholder',
        src,
        path: this.storage.pathForKey(key),
        id: originalId(src),
        size: Buffer.byteLength(dataUrl),
        contentType: '',
        width: 0,
        height: 0,
        format: '',
      });
      return { dataUrl };
    });
  }
}
