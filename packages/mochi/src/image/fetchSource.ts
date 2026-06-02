import { assertAllowedSource } from './ssrfGuard';
import { applyFilter } from '../extensions';
import { ImageError } from './types';
import type { ResolvedImageOptions } from './types';

export interface FetchedSource {
  bytes: Uint8Array;
  contentType: string | null;
}

const DEFAULT_MAX_REDIRECTS = 5;

export async function fetchImageSource(src: string, opts: ResolvedImageOptions): Promise<FetchedSource> {
  // One timeout bounds the whole chain (all redirect hops), not each hop.
  const signal = AbortSignal.timeout(opts.fetchTimeoutMs);

  // Cap re-validated redirect hops; overridable per-source via the filter.
  const maxRedirects = applyFilter('image:maxRedirects', DEFAULT_MAX_REDIRECTS, { src });

  // Follow redirects manually so the SSRF guard re-validates EVERY hop: an
  // allowed/public host must not be able to 302 us into a private network.
  let target = src;
  let res: Response;
  for (let hop = 0; ; hop++) {
    const url = await assertAllowedSource(target, {
      allowedHosts: opts.allowedHosts,
      blockPrivateNetworks: opts.blockPrivateNetworks,
    });

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
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxSizeInBytes) {
      throw new ImageError(413, 'Source image exceeds the maximum size');
    }
    return buf;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        throw new ImageError(413, 'Source image exceeds the maximum size');
      }
      chunks.push(value);
    }
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
