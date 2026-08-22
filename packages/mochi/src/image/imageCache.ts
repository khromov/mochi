import { createHash } from 'node:crypto';
import type { CacheStatus, Storage } from '../cache/cache';
import { MochiCache } from '../cache/cache';
import { FileStorage, isBlobRef, readBlobRef, type BlobRef } from '../cache/cache-storage';
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
   * `createdAt` of the original generation these bytes were encoded from. A regen against a still-stale original stamps
   * the old generation honestly, so the next request sees the mismatch and regenerates once the original has refreshed;
   * stamping the new generation onto bytes resized from the old one would serve stale content as fresh.
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
 * Identifies a variant by its source and the size's config hash, which already folds in every byte-affecting field
 * (dims, ops, format, quality). A size redefinition therefore changes the id — a new cache entry and ETag — while two
 * sizes with identical config share one entry. TTLs stay out of the key.
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
 * Image cache backed by {@link MochiCache} over {@link FileStorage}. Originals, resized variants, and blur placeholders
 * are each an entry under the `MochiImage:Original:` / `MochiImage:Variant:` / `MochiImage:Placeholder:` key convention,
 * taking their SWR window, request coalescing, and binary persistence from the shared cache primitives.
 *
 * A variant has no window of its own: it serves fresh only while the shared original is fresh and its stamped
 * `originalCreatedAt` matches, and otherwise serves stale while regenerating in the background. Hard invalidation
 * deletes the original key, whose `cache:delete` cascades to that source's variants and placeholder; the age-based
 * sweep reclaims the rest.
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
    // Eviction stays the backend's; only the schedule and per-kind accounting live here. FileStorage's own timer is off
    // (`purgeInterval: 0`) and `sweeper.ts` drives `sweep()` instead — one janitor, on an interval the image config
    // owns, reporting variants and originals separately, with `maxAge >= maxTimeToLive` so a servable entry survives.
    // A caller-supplied `storage` keeps its own eviction policy, and driving it from here puts every backend on that one
    // schedule. `offloadBinary` is on because image bytes are the large-binary case blob offloading exists for.
    this.storage = options.storage ?? new FileStorage({ directory: options.cacheDir, maxAge: options.maxTimeToLive, purgeInterval: 0, offloadBinary: true });
    // A regen (fetch upstream → decode → resize) holds the per-key coalescing lock only briefly, so a 60s timeout makes
    // a hung upstream fail fast instead of parking every waiter until the far larger default. The cache dir is shared
    // across load-balanced processes, so `crossProcessInflight` lets an advisory marker — leased to that same 60s — save
    // peers a duplicate regen.
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
   * Release this cache's bus subscription and stop its storage's timers, for teardown in tests or an explicitly owned
   * instance. Server stop uses the sweeper's timers instead, since `getImageRuntime()` is a global singleton outliving a
   * `Mochi.serve()` cycle and disposing it there would leave the next server a live cache whose cascade no longer fires.
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
   * Read a cached variant keyed by its `variantId`. It serves fresh only while the shared original is fresh and the
   * variant was encoded from that exact generation; a stale original or generation mismatch serves the in-hand bytes
   * stale and regenerates in the background, stamping the generation it actually encoded from, so a regen racing a
   * still-refreshing original converges on the next request. The original is probed through a lazy blob ref, so a fresh
   * variant serve leaves its bytes on disk.
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

  /** Get-or-fetch the full-size original bytes for a source, keyed by `src` alone and shared across every variant under the cache's one global stale/evict window. */
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
   * Immediately invalidate a source. `hard` deletes the original key, whose `cache:delete` cascades to every variant and
   * the placeholder; `soft` marks the original stale so the variant mirror serves stale-while-revalidate.
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
   * Empty the entire image cache — every original, resized variant, and blur placeholder — by clearing the backing
   * storage in one shot. A wholesale reset for the dev debug bar, so it stays silent where `invalidateOriginal` emits a
   * per-entry `image:delete`.
   */
  async clearAll(): Promise<void> {
    await this.cache.clearItems();
  }

  /** Resolves once in-flight regenerations — including the background ones a stale read starts — have settled. See {@link MochiCache.whenIdle}. */
  async whenIdle(): Promise<void> {
    await this.cache.whenIdle();
  }

  /** Entries currently cached — originals, variants, placeholders, and transient in-flight markers — as a rough size indicator for the dev debug bar. `0` when the backend can't count. */
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
