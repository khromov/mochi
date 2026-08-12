import { RENDERER_VERSION, renderOgCard, type OgSubject } from './render.ts';

const DEVELOPMENT = process.env.MODE === 'development';

const cards = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();

export function ogCacheKey({ kind, title, date }: OgSubject): string {
  return new Bun.CryptoHasher('sha256').update(`og:v${RENDERER_VERSION}:${kind}:${title}:${date ?? ''}`).digest('base64url').slice(0, 22);
}

export function getOgCard(subject: OgSubject): Promise<Uint8Array<ArrayBuffer>> {
  // The key covers the subject, not the drawing code, so a design edit would otherwise serve the
  // pre-edit card until someone bumped RENDERER_VERSION.
  if (DEVELOPMENT) {
    return renderOgCard(subject);
  }

  const key = ogCacheKey(subject);
  const hit = cards.get(key);
  if (hit) {
    return hit;
  }

  // Held as the promise, so concurrent requests for a cold card share one render.
  const card = renderOgCard(subject).catch((error: unknown) => {
    cards.delete(key);
    throw error;
  });
  cards.set(key, card);
  return card;
}
