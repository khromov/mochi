import path from 'node:path';
import { FileStorage, MochiCache, isBlobRef, readBlobRef } from 'mochi-framework';
import { SITE_ROOT } from '../lib/siteRoot.ts';
import { RENDERER_VERSION, renderOgCard, type OgSubject } from './render.ts';

/**
 * A sibling of the framework's image cache rather than a subdirectory of it — that tree has its own
 * sweeper, and these entries are not image variants.
 */
const CACHE_DIR =
  process.env.MOCHI_OG_CACHE_DIR ??
  (process.env.MOCHI_IMAGE_CACHE_DIR ? path.join(path.dirname(process.env.MOCHI_IMAGE_CACHE_DIR), 'og-cache') : path.join(SITE_ROOT, '.mochi', 'og-cache'));

const DEVELOPMENT = process.env.MODE === 'development';

const MAX_TIME_TO_LIVE = 2_592_000_000;

const cache = new MochiCache({
  minTimeToStale: 86_400_000,
  maxTimeToLive: MAX_TIME_TO_LIVE,
  storage: new FileStorage({ directory: CACHE_DIR, offloadBinary: true, maxAge: MAX_TIME_TO_LIVE }),
  // The site runs more than one process; without this a cold deploy has each of them rendering the
  // same card at the same moment.
  crossProcessInflight: true,
});

/** Bounded so a long-lived process can't accumulate one card per title in memory. */
const HOT_LIMIT = 64;
const hot = new Map<string, Uint8Array<ArrayBuffer>>();

export function ogCacheKey({ kind, title }: OgSubject): string {
  return new Bun.CryptoHasher('sha256').update(`og:v${RENDERER_VERSION}:${kind}:${title}`).digest('base64url').slice(0, 22);
}

export async function getOgCard(subject: OgSubject): Promise<Uint8Array<ArrayBuffer>> {
  const key = ogCacheKey(subject);

  // The key covers the subject and RENDERER_VERSION but not the drawing code, so while iterating on
  // the design every edit would otherwise serve the pre-edit card until someone bumped the version.
  if (DEVELOPMENT) {
    return renderOgCard(subject);
  }

  const cached = hot.get(key);
  if (cached) {
    return cached;
  }

  const stored = await cache.fetch(key, () => renderOgCard(subject));
  const bytes = isBlobRef(stored) ? new Uint8Array(await readBlobRef(stored)) : (stored as Uint8Array<ArrayBuffer>);

  if (hot.size >= HOT_LIMIT) {
    hot.delete(hot.keys().next().value!);
  }
  hot.set(key, bytes);
  return bytes;
}
