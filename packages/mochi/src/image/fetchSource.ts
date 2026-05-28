import { assertAllowedSource } from './ssrfGuard';
import { ImageError } from './types';
import type { ResolvedImageOptions } from './types';

export interface FetchedSource {
  bytes: Uint8Array;
  contentType: string | null;
}

/** Fetch a remote image with SSRF guard, timeout, and a hard response-size cap. */
export async function fetchImageSource(src: string, opts: ResolvedImageOptions): Promise<FetchedSource> {
  const url = await assertAllowedSource(src, {
    allowedHosts: opts.allowedHosts,
    blockPrivateNetworks: opts.blockPrivateNetworks,
  });

  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(opts.fetchTimeoutMs),
      redirect: 'follow',
      headers: { Accept: 'image/*' },
    });
  } catch {
    throw new ImageError(502, 'Failed to fetch source image');
  }

  if (!res.ok) {
    throw new ImageError(502, `Source responded with ${res.status}`);
  }

  const declaredLength = Number(res.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > opts.maxResponseBytes) {
    throw new ImageError(413, 'Source image exceeds the maximum size');
  }

  const bytes = await readCapped(res, opts.maxResponseBytes);
  return { bytes, contentType: res.headers.get('content-type') };
}

async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > max) {
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
