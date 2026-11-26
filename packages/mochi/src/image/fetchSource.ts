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

// Each in-flight fetch buffers up to ~2x `maxResponseBytes`, so the process-wide count is capped, and one host may hold
// at most half the slots so a slow upstream cannot make every other host's fetches wait out `fetchTimeoutMs`.
const fetchGate = pinGlobal('__mochi_image_fetch_gate__', () => ({
  active: 0,
  perHost: new Map<string, number>(),
  waiting: new Map<string, Array<{ seq: number; wake: () => void }>>(),
  seq: 0,
}));

function hasRoom(host: string, limit: number): boolean {
  return fetchGate.active < limit && (fetchGate.perHost.get(host) ?? 0) < Math.max(1, Math.floor(limit / 2));
}

function admit(host: string): void {
  fetchGate.active++;
  fetchGate.perHost.set(host, (fetchGate.perHost.get(host) ?? 0) + 1);
}

function acquireFetchSlot(host: string, limit: number, signal: AbortSignal): Promise<void> {
  if (hasRoom(host, limit)) {
    admit(host);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const queue = fetchGate.waiting.get(host) ?? [];
    const waiter = {
      seq: fetchGate.seq++,
      wake: (): void => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
    };
    const onAbort = (): void => {
      queue.splice(queue.indexOf(waiter), 1);
      if (queue.length === 0) {
        fetchGate.waiting.delete(host);
      }
      reject(new ImageError(503, 'Too many concurrent source image fetches'));
    };
    queue.push(waiter);
    fetchGate.waiting.set(host, queue);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function releaseFetchSlot(host: string, limit: number): void {
  fetchGate.active--;
  const left = (fetchGate.perHost.get(host) ?? 1) - 1;
  if (left > 0) {
    fetchGate.perHost.set(host, left);
  } else {
    fetchGate.perHost.delete(host);
  }
  // Oldest waiter first, skipping hosts at their share: round-robin would hand each slot a short fetch frees to a slow host.
  for (;;) {
    let next: [string, Array<{ seq: number; wake: () => void }>] | undefined;
    for (const entry of fetchGate.waiting) {
      if (hasRoom(entry[0], limit) && (!next || entry[1][0]!.seq < next[1][0]!.seq)) {
        next = entry;
      }
    }
    if (!next) {
      return;
    }
    const [nextHost, queue] = next;
    const { wake } = queue.shift()!;
    if (queue.length === 0) {
      fetchGate.waiting.delete(nextHost);
    }
    admit(nextHost);
    wake();
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
  // Redirect hops stay charged to the host the source URL names.
  const host = URL.parse(src)?.host ?? '';
  const limit = opts.maxConcurrentFetches;
  await acquireFetchSlot(host, limit, signal);
  try {
    return await fetchRemoteSource(src, opts, signal);
  } finally {
    releaseFetchSlot(host, limit);
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
