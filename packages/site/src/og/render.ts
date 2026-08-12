import { createCanvas } from '@napi-rs/canvas';
import { CARD_HEIGHT, CARD_WIDTH } from './brand.ts';
import { paintBackground } from './background.ts';
import { drawPageCard, drawRootCard } from './cards.ts';

/** Bumped whenever a change alters pixels; folded into the cache key so entries and ETags roll over. */
export const RENDERER_VERSION = 1;

export type OgKind = 'root' | 'doc' | 'blog' | 'demo' | 'page';

export interface OgSubject {
  kind: OgKind;
  title: string;
  /** A post's `YYYY-MM-DD` frontmatter date, appended to the kicker. */
  date?: string;
}

const KICKERS: Record<Exclude<OgKind, 'root'>, string> = {
  doc: 'Documentation',
  blog: 'Blog',
  demo: 'Demo',
  // A standalone page's title already says what it is; a second label would just repeat it.
  page: '',
};

/** `2026-06-21` → `21.06.2026`. Reformatted as a string: the frontmatter is validated as a plain
 * date, and parsing it into a Date would shift it a day either side of UTC. */
function formatDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}.${month}.${year}`;
}

function kickerFor({ kind, date }: OgSubject): string {
  const label = KICKERS[kind as Exclude<OgKind, 'root'>];
  return date ? `${label} · ${formatDate(date)}` : label;
}

export async function renderOgCard(subject: OgSubject): Promise<Uint8Array<ArrayBuffer>> {
  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext('2d');

  await paintBackground(ctx);
  if (subject.kind === 'root') {
    await drawRootCard(ctx);
  } else {
    await drawPageCard(ctx, { title: subject.title, kicker: kickerFor(subject) });
  }

  // JPEG rather than PNG: the grain is incompressible, so the same card is ~1MB as a PNG. 84 keeps
  // more of it than the hand-made `og-default.jpg` this replaces (measured sd 2.17 against its 1.5–2.1).
  // Copied out of the native buffer so nothing retains the canvas.
  return new Uint8Array(await canvas.encode('jpeg', 84));
}
