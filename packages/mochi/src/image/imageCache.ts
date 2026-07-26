import { createHash } from 'node:crypto';
import type { CacheStatus, Storage } from '../cache/cache';
import { MochiCache } from '../cache/cache';
import { FileStorage, isBlobRef, readBlobRef, type BlobRef } from '../cache/cache-storage';
import { unregisterSweepable } from '../cache/sweepRegistry';
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
  /** Which original generation produced these bytes (variants only). Folded into the variant ETag. */
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
  /**
   * `createdAt` of the original generation these bytes were encoded from. A regen
   * that ran against a still-stale original honestly stamps the old generation, so
   * the next request sees the mismatch and regenerates again once the original has
   * refreshed — stamping the new generation onto bytes resized from the old one
   * would serve stale content as fresh.
   */
  originalCreatedAt: number;
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
const ORIG_PREFIX = 'MochiImage:Original:';
const VAR_PREFIX = 'MochiImage:Variant:';
const PH_PREFIX = 'MochiImage:Placeholder:';
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
  // Generation identity: unlike the cache envelope's createdAt (which markStale
  // backdates), this survives soft invalidation, so variants/placeholders can be
  // compared against the exact original generation that produced them.
  createdAt: number;
  contentType: string;
  etag: string;
  width: number;
  height: number;
  format: string;
  bytes: Uint8Array | BlobRef;
  /** For variants: the original generation the bytes were encoded from. */
  originalCreatedAt?: number;
}

interface StoredPlaceholder {
  dataUrl: string;
  /** The original generation the blur was computed from; a refreshed original invalidates it. */
  originalCreatedAt: number;
}

export interface ImageCacheOptions {
  cacheDir: string;
  /** One global stale-while-revalidate window shared by every entry. */
  minTimeToStale: number;
  maxTimeToLive: number;
  /** Configured named sizes — the cascade deletes each source's variants by these. */
  sizes: Record<string, ResolvedImageSize>;
  /** Override the default `FileStorage(cacheDir)` backend. `cacheDir` is ignored when set. */
  storage?: Storage;
}

// Each instance subscribes its own cascade, so the handler name must be unique —
// a shared name would make a second instance silently evict the first's.
let cascadeSeq = 0;

// A `path` label for `image:store`/`image:delete` events. Cosmetic — falls back
// to the raw key for a backend (e.g. `MemoryStorage`) that has no file path.
function pathForKey(storage: Storage, key: string): string {
  const withPath = storage as Partial<{ pathForKey(key: string): string }>;
  return typeof withPath.pathForKey === 'function' ? withPath.pathForKey(key) : key;
}

/**
 * Image cache backed by {@link MochiCache} over {@link FileStorage}. Originals,
 * resized variants, and blur placeholders are each a cache entry under the
 * `MochiImage:Original:` / `MochiImage:Variant:` / `MochiImage:Placeholder:` key
 * convention; the SWR window, request coalescing, and binary persistence all come
 * from the shared cache primitives.
 *
 * A variant has no window of its own — it serves fresh only while the shared
 * original is fresh and the variant's stamped generation (`originalCreatedAt`)
 * matches it; otherwise it serves stale and regenerates in the background. Hard
 * invalidation deletes the original key, whose `cache:delete` event cascades to
 * the source's variants and placeholder; everything else is reclaimed by the
 * age-based sweep.
 */
export class ImageCache {
  private readonly storage: Storage;
  private readonly cache: MochiCache;
  private readonly minTimeToStale: number;
  private readonly maxTimeToLive: number;
  private readonly sizes: Record<string, ResolvedImageSize>;
  private readonly cascadeHandlerName: string;

  constructor(options: ImageCacheOptions) {
    this.minTimeToStale = options.minTimeToStale;
    this.maxTimeToLive = options.maxTimeToLive;
    this.sizes = options.sizes;
    // Eviction stays the backend's; only the schedule and per-kind accounting live
    // here. So the storage sits out the shared `mochi:cache-sweep` janitor and
    // `sweeper.ts` drives `sweep()` on a schedule the image config owns, reporting
    // variants/originals separately. `maxAge >= maxTimeToLive` never drops a
    // servable entry; offloadBinary keeps metadata reads off the encoded bytes.
    this.storage = options.storage ?? new FileStorage({ directory: options.cacheDir, maxAge: options.maxTimeToLive, purge: false, offloadBinary: true });
    // A caller-supplied storage registered itself on construction, before it knew it was destined for an ImageCache — leaving it on sweeps it twice on two schedules.
    unregisterSweepable(this.storage);
    // 60s in-flight timeout: an image regen (fetch upstream → decode → resize)
    // should never hold the per-key coalescing lock for long, so a hung upstream
    // fails fast instead of parking every waiter until the far larger default.
    // crossProcessInflight: the cache dir is shared across load-balanced processes,
    // so an advisory marker lets peers skip duplicate regens (lease = the 60s above).
    this.cache = new MochiCache({
      minTimeToStale: this.minTimeToStale,
      maxTimeToLive: this.maxTimeToLive,
      storage: this.storage,
      inflightTimeout: 60_000,
      crossProcessInflight: true,
    });
    // Cascade: deleting a source's original key reclaims its variants + placeholder.
    // `setHandler` (not `.on`) so a dev re-import replaces rather than stacks the sub.
    // Each cascade only ever reclaims what's in its own storage, so instances that
    // share the bus don't interfere; `dispose()` unsubscribes.
    this.cascadeHandlerName = `mochi-image:cache-delete:${++cascadeSeq}`;
    mochiEvents.setHandler(this.cascadeHandlerName, 'cache:delete', (event) => {
      if (event.key.startsWith(ORIG_PREFIX)) {
        void this.cascadeSource(event.key.slice(ORIG_PREFIX.length), 'invalidated').catch(() => {});
      }
    });
  }

  /**
   * Release this cache's bus subscription and stop its storage's own timers. For
   * teardown (tests, or an explicitly owned instance).
   *
   * Not called on server stop: `getImageRuntime()` is a global singleton that
   * outlives a `Mochi.serve()` cycle, so disposing it there would leave the next
   * server with a live cache whose cascade no longer fires. The scheduler stops the
   * `mochi:image-sweep` task on shutdown instead.
   */
  dispose(): void {
    mochiEvents.removeHandler(this.cascadeHandlerName);
    (this.storage as Partial<{ dispose(): void }>).dispose?.();
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
      originalCreatedAt: value.originalCreatedAt,
    };
  }

  /**
   * Read a cached variant keyed by its `variantId` (source + size config hash).
   * A variant has no window of its own: it is served fresh only while the shared
   * original is fresh AND the variant was encoded from that exact original
   * generation (`originalCreatedAt`). A stale original or a generation mismatch
   * serves the in-hand bytes stale and regenerates in the background; the regen
   * stamps the generation it actually encoded from, so a regen that raced a
   * still-refreshing original converges on the next request instead of serving
   * old bytes as fresh. Probing the original uses a lazy blob ref, so a fresh
   * variant serve never loads the original's bytes.
   */
  async getVariant(src: string, id: string, regenerate: () => Promise<RegenResult>): Promise<{ entry: CacheEntry; status: ImageCacheStatus }> {
    const key = varKey(id);
    const orig = await this.cache.peek<StoredImage>(origKey(src));
    if (!orig || orig.status === 'expired') {
      // Original gone or past its window: the variant must not be served, so drop
      // it (if present) and regenerate against a freshly fetched original. The
      // peek-first guard keeps a cold start (nothing stored) from clearing the
      // in-flight slot on every request, which would defeat request coalescing.
      if (await this.cache.peek<StoredImage>(key)) {
        await this.cache.delete(key);
      }
    } else {
      const existing = await this.cache.peek<StoredImage>(key);
      // Only backdate an entry the cache still considers fresh — a stale/expired
      // entry already regenerates, and markStale would needlessly kill its
      // in-flight regen (discarding the work via the supersession guard).
      if (existing && existing.status === 'fresh' && (orig.status === 'stale' || existing.value.originalCreatedAt !== orig.value.createdAt)) {
        await this.cache.markStale(key);
      }
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
        originalCreatedAt: r.originalCreatedAt,
      };
      mochiEvents.emit('image:store', {
        kind: 'variant',
        src,
        path: pathForKey(this.storage, key),
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
   * variant and keyed by `src` alone. Every entry shares the one global
   * stale/evict window configured on the cache.
   */
  async getOriginal(src: string, fetchFn: () => Promise<{ bytes: Uint8Array; contentType: string | null }>): Promise<{ entry: CacheEntry; status: ImageCacheStatus }> {
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
        path: pathForKey(this.storage, key),
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
        path: pathForKey(this.storage, key),
        id: originalId(src),
        size: storedBytesLen(orig.value.bytes),
        reason: 'invalidated',
      });
    }
  }

  /**
   * Empty the entire image cache — every original, resized variant, and blur
   * placeholder — by clearing the backing storage in one shot. Unlike
   * `invalidateOriginal`, this does not emit a per-entry `image:delete`; it's a
   * wholesale reset intended for the dev debug bar. No-op on an empty cache.
   */
  async clearAll(): Promise<void> {
    await this.cache.clearItems();
  }

  /**
   * Number of entries currently in the cache (originals + variants + placeholders,
   * plus any transient in-flight markers) — a rough size indicator for the dev
   * debug bar. Returns `0` if the backing storage can't report a count.
   */
  async count(): Promise<number> {
    return (await this.storage.count?.()) ?? 0;
  }

  /** Cache keys (originals, variants, placeholders) for the dev debug bar. Excludes the transient `mochi:inflight:` coalescing markers. Empty if the backing storage can't enumerate. */
  async keys(): Promise<string[]> {
    const keys = (await this.storage.keys?.()) ?? [];
    return keys.filter((key) => !key.startsWith('mochi:inflight:'));
  }

  /** The raw stored entry for a key (`{ value, createdAt }`), or `null` if absent. Binary fields come back as lazy {@link BlobRef}s, not bytes — safe to serialize for the dev debug bar. */
  async inspect(key: string): Promise<unknown> {
    return this.storage.getItem(key);
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
        path: pathForKey(this.storage, phKey(src)),
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
          path: pathForKey(this.storage, varKey(id)),
          id,
          size: storedBytesLen(variant.value.bytes),
          reason,
        });
      }
    }
  }

  /**
   * Janitor sweep: reclaim entries past the global window. The eviction itself is
   * the storage backend's own age-based sweep (`FileStorage` or a configured
   * `MemoryStorage`); a backend with no `sweep` support is a no-op. All this adds
   * is per-kind attribution, from the keys the backend reports removing.
   *
   * Anything the backend can't name — `mochi:inflight:` markers, `.tmp` writes,
   * corrupt files, or every removal from a backend that ignores `reportKeys` —
   * lands in `removedOther` rather than being guessed at, so the three counts
   * always sum to what was actually removed.
   */
  async sweep(now: number = Date.now()): Promise<{ removedVariants: number; removedOriginals: number; removedOther: number }> {
    const result = await this.storage.sweep?.(now, { reportKeys: true });
    const removed = result?.removed ?? 0;
    let removedOriginals = 0;
    let removedVariants = 0;
    for (const key of result?.removedKeys ?? []) {
      if (key.startsWith(ORIG_PREFIX)) {
        removedOriginals++;
      } else if (key.startsWith(VAR_PREFIX) || key.startsWith(PH_PREFIX)) {
        removedVariants++;
      }
    }
    return { removedVariants, removedOriginals, removedOther: removed - removedVariants - removedOriginals };
  }

  /**
   * Placeholders are gated by the original's generation: a blur computed from a
   * previous generation reads as missing (recompute), so a refreshed source
   * doesn't keep painting the old image's ThumbHash. With no original cached
   * there's nothing to compare against — serve what we have (cosmetic anyway).
   */
  async getPlaceholder(src: string): Promise<string | null> {
    const cached = await this.cache.peek<StoredPlaceholder>(phKey(src));
    if (!cached || cached.status === 'expired') {
      return null;
    }
    const orig = await this.cache.peek<StoredImage>(origKey(src));
    if (orig && cached.value.originalCreatedAt !== orig.value.createdAt) {
      return null;
    }
    return cached.value.dataUrl;
  }

  async setPlaceholder(src: string, dataUrl: string, originalCreatedAt: number): Promise<void> {
    const key = phKey(src);
    // `set`, not `delete` + `fetch`: a recompute (the original moved on to a new
    // generation) must replace the entry in one atomic write. Deleting first left the
    // key absent for the duration of the write, so concurrent readers saw a miss and
    // each kicked off their own placeholder recompute.
    await this.cache.set<StoredPlaceholder>(key, { dataUrl, originalCreatedAt });
    mochiEvents.emit('image:store', {
      kind: 'placeholder',
      src,
      path: pathForKey(this.storage, key),
      id: originalId(src),
      size: Buffer.byteLength(dataUrl),
      contentType: '',
      width: 0,
      height: 0,
      format: '',
    });
  }
}
