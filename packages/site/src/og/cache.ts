import { MochiCache } from 'mochi-framework';
import { RENDERER_VERSION, renderOgCard, type OgSubject } from './render.ts';

const DEVELOPMENT = process.env.MODE === 'development';

// Default in-memory storage — cards are cheap to redraw and the key space is the finite set of
// resolvable site paths, so there is nothing worth persisting to disk. `fetch` coalesces concurrent
// requests for a cold card into one render.
const cache = new MochiCache({ minTimeToStale: 86_400_000, maxTimeToLive: 604_800_000 });

export function ogCacheKey({ kind, title, date }: OgSubject): string {
  return new Bun.CryptoHasher('sha256').update(`og:v${RENDERER_VERSION}:${kind}:${title}:${date ?? ''}`).digest('base64url').slice(0, 22);
}

export function getOgCard(subject: OgSubject): Promise<Uint8Array<ArrayBuffer>> {
  // The key covers the subject, not the drawing code, so a design edit would otherwise serve the
  // pre-edit card until someone bumped RENDERER_VERSION.
  if (DEVELOPMENT) {
    return renderOgCard(subject);
  }
  return cache.fetch(ogCacheKey(subject), () => renderOgCard(subject));
}
