import { MochiCache } from 'mochi-framework';
import { RENDERER_VERSION, renderOgCard, type OgSubject } from './render.ts';

const IS_DOCKER = process.env.MOCHI_DOCKER === 'true';

const cache = new MochiCache({ minTimeToStale: 86_400_000, maxTimeToLive: 604_800_000 });

export function ogCacheKey({ kind, title, date }: OgSubject): string {
  return new Bun.CryptoHasher('sha256')
    .update(`og:v${RENDERER_VERSION}:${kind}:${title}:${date ?? ''}`)
    .digest('base64url')
    .slice(0, 22);
}

export function getOgCard(subject: OgSubject): Promise<Uint8Array<ArrayBuffer>> {
  // The key covers the subject, not the drawing code, so only the deployed container caches.
  if (!IS_DOCKER) {
    return renderOgCard(subject);
  }
  return cache.fetch(ogCacheKey(subject), () => renderOgCard(subject));
}
