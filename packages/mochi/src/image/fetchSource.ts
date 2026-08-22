import { resolvePublicUrl, SsrfGuardError } from '../utils/assertPublicUrl';
import { applyFilter } from '../extensions';
import { getLocalImageAsset } from './localAssetRegistry';
import { ImageError } from './types';
import type { ResolvedImageOptions } from './types';

export interface FetchedSource {
  bytes: Uint8Array;
  contentType: string | null;
}

const DEFAULT_MAX_REDIRECTS = 5;

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

export async function fetchImageSource(src: string, opts: ResolvedImageOptions): Promise<FetchedSource> {
  // A locally-imported asset's `src` is a same-origin `/_mochi/asset/…` URL that `assertPublicUrl` would reject, so the
  // bytes are read straight from disk. Only build-registered URLs are readable, since request input acts as a Map key
  // rather than a filesystem path, and the src arrives decrypted from an authenticated token.
  const local = getLocalImageAsset(src);
  if (local) {
    return { bytes: await Bun.file(local.diskPath).bytes(), contentType: local.contentType };
  }

  // One timeout bounds the whole chain (all redirect hops), not each hop.
  const signal = AbortSignal.timeout(opts.fetchTimeoutMs);

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

    try {
      const request = createPinnedFetchRequest(resolved.url, resolved.address, signal);
      res = await fetch(request.url, request.init);
    } catch {
      throw new ImageError(502, 'Failed to fetch source image');
    }

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
