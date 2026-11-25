import { resolvePublicUrl, SsrfGuardError } from '../utils/publicUrl';
import { applyFilter } from '../extensions';
import { pinGlobal } from '../utils/globalState';
import { getLocalImageAsset } from './localAssetRegistry';
import { ImageError } from './types';
import type { ResolvedImageOptions } from './types';

export interface FetchedSource {
  bytes: Uint8Array;
  contentType: string | null;
}

const DEFAULT_MAX_REDIRECTS = 5;

// Each in-flight fetch buffers up to ~2x `maxResponseBytes`, so a burst of distinct cold sources must queue rather than all be resident at once.
export const MAX_CONCURRENT_SOURCE_FETCHES = 8;

const fetchSlots = pinGlobal('__mochi_image_fetch_slots__', () => ({ active: 0, waiting: [] as Array<() => void> }));

function acquireFetchSlot(signal: AbortSignal): Promise<void> {
  if (fetchSlots.active < MAX_CONCURRENT_SOURCE_FETCHES) {
    fetchSlots.active++;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const wake = (): void => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = (): void => {
      fetchSlots.waiting.splice(fetchSlots.waiting.indexOf(wake), 1);
      reject(new ImageError(503, 'Too many concurrent source image fetches'));
    };
    fetchSlots.waiting.push(wake);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function releaseFetchSlot(): void {
  const next = fetchSlots.waiting.shift();
  if (next) {
    next();
  } else {
    fetchSlots.active--;
  }
}

export interface PinnedFetchRequest {
  url: URL;
  init: BunFetchRequestInit;
}

export function createPinnedFetchRequest(url: URL, address: string | undefined, signal: AbortSignal): PinnedFetchRequest {
  if (!address) {
    return {
      url,
      init: { signal, redirect: 'manual', headers: { Accept: 'image/*' } },
    };
  }

  const pinned = new URL(url);
  pinned.hostname = address.includes(':') ? `[${address}]` : address;
  const init: BunFetchRequestInit = {
    signal,
    redirect: 'manual',
    headers: { Accept: 'image/*', Host: url.host },
  };
  if (url.protocol === 'https:') {
    // Connect to the validated IP while preserving the original hostname for SNI and certificate verification.
    init.tls = { serverName: url.hostname.replace(/^\[|\]$/g, '') };
  }
  return { url: pinned, init };
}

/**
 * Connect to the pre-validated addresses in order, falling back to the next on a connect failure. Every address was
 * validated together, so this keeps the multi-address failover a plain hostname fetch would have done — one dead
 * edge of a CDN must not fail the request. Resolves to undefined when none of them answered.
 */
export async function fetchPinned(url: URL, addresses: string[], signal: AbortSignal): Promise<Response | undefined> {
  const candidates: Array<string | undefined> = addresses.length > 0 ? addresses : [undefined];
  for (const address of candidates) {
    const request = createPinnedFetchRequest(url, address, signal);
    try {
      return await fetch(request.url, request.init);
    } catch {
      if (signal.aborted) {
        return undefined;
      }
    }
  }
  return undefined;
}

export async function fetchImageSource(src: string, opts: ResolvedImageOptions): Promise<FetchedSource> {
  // A locally-imported asset's `src` is a same-origin `/_mochi/asset/…` URL that `resolvePublicUrl` would reject, so the
  // bytes are read straight from disk. Only build-registered URLs are readable, since request input acts as a Map key
  // rather than a filesystem path, and the src arrives decrypted from an authenticated token.
  const local = getLocalImageAsset(src);
  if (local) {
    return { bytes: await Bun.file(local.diskPath).bytes(), contentType: local.contentType };
  }

  // One timeout bounds the whole chain (the wait for a fetch slot and all redirect hops), not each hop.
  const signal = AbortSignal.timeout(opts.fetchTimeoutMs);
  await acquireFetchSlot(signal);
  try {
    return await fetchRemoteSource(src, opts, signal);
  } finally {
    releaseFetchSlot();
  }
}

async function fetchRemoteSource(src: string, opts: ResolvedImageOptions, signal: AbortSignal): Promise<FetchedSource> {
  // Cap re-validated redirect hops; overridable per-source via the filter.
  const maxRedirects = applyFilter('image:maxRedirects', DEFAULT_MAX_REDIRECTS, { src });

  // Follow redirects manually so the SSRF guard re-validates EVERY hop: an
  // allowed/public host must not be able to 302 us into a private network.
  let target = src;
  let res: Response;
  for (let hop = 0; ; hop++) {
    let resolved: Awaited<ReturnType<typeof resolvePublicUrl>>;
    try {
      resolved = await resolvePublicUrl(target, {
        allowedHosts: opts.allowedHosts,
        blockPrivateNetworks: opts.blockPrivateNetworks,
      });
    } catch (e) {
      if (e instanceof SsrfGuardError) {
        throw new ImageError(400, e.message);
      }
      throw e;
    }

    const fetched = await fetchPinned(resolved.url, resolved.addresses, signal);
    if (!fetched) {
      throw new ImageError(502, 'Failed to fetch source image');
    }
    res = fetched;

    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= maxRedirects) {
        throw new ImageError(502, 'Too many redirects');
      }
      await res.body?.cancel();
      target = new URL(location, resolved.url).href; // resolve relative redirects against the original-host URL
      continue;
    }
    break;
  }

  if (!res.ok) {
    throw new ImageError(502, `Source responded with ${res.status}`);
  }

  const declaredLength = Number(res.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > opts.maxResponseBytes) {
    throw new ImageError(413, 'Source image exceeds the maximum size');
  }

  const bytes = await readWithMaxSize(res, opts.maxResponseBytes);
  return { bytes, contentType: res.headers.get('content-type') };
}

async function readWithMaxSize(res: Response, maxSizeInBytes: number): Promise<Uint8Array> {
  // Stream the body so we can abort the moment the running total crosses the cap
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of res.body ?? []) {
    if ((total += chunk.byteLength) > maxSizeInBytes) {
      throw new ImageError(413, 'Source image exceeds the maximum size');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
