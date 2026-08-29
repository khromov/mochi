import { assertPublicUrl, SsrfGuardError } from '../utils/assertPublicUrl';
import { applyFilter } from '../extensions';
import { getLocalImageAsset } from './localAssetRegistry';
import { resolveStaticDirImage } from './localImage';
import { ImageError } from './types';
import type { ResolvedImageOptions } from './types';

export interface FetchedSource {
  bytes: Uint8Array;
  contentType: string | null;
}

const DEFAULT_MAX_REDIRECTS = 5;

export async function fetchImageSource(src: string, opts: ResolvedImageOptions): Promise<FetchedSource> {
  // A locally-imported asset's `src` is a same-origin `/_mochi/asset/…` URL that `assertPublicUrl` would reject, so the
  // bytes are read straight from disk. Only build-registered URLs are readable, since request input acts as a Map key
  // rather than a filesystem path, and the src arrives decrypted from an authenticated token.
  const local = getLocalImageAsset(src);
  if (local) {
    return { bytes: await Bun.file(local.diskPath).bytes(), contentType: local.contentType };
  }

  // An image served by a `staticDirs` mount: same-origin src, same trust argument as above — the resolver confines
  // reads to the mounted roots, and the raster gate keeps transforms off non-image files (a `.zip` src falls through
  // and is rejected as a URL).
  const mounted = resolveStaticDirImage(src);
  if (mounted) {
    const file = Bun.file(mounted.diskPath);
    if (!(await file.exists())) {
      throw new ImageError(404, `Local image not found: ${src}`);
    }
    return { bytes: await file.bytes(), contentType: mounted.contentType };
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
    let url: URL;
    try {
      url = await assertPublicUrl(target, {
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
      res = await fetch(url, {
        signal,
        redirect: 'manual',
        headers: { Accept: 'image/*' },
      });
    } catch {
      throw new ImageError(502, 'Failed to fetch source image');
    }

    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= maxRedirects) {
        throw new ImageError(502, 'Too many redirects');
      }
      await res.body?.cancel();
      target = new URL(location, url).href; // resolve relative redirects
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
