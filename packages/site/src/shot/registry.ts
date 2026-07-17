import { error, mintCaptcha } from 'mochi-framework';
import { themes } from '../demos/captcha-styling/themes';

export type ShotSubject = {
  /** Resolved per request, server-side — same contract as a page's serverProps. */
  props: (url: URL) => Record<string, unknown>;
  /**
   * The subject's unscaled CSS-pixel box. It's the sole source of truth for the
   * subject's width (the frame applies it), and the frame scales up from it to
   * fill the canvas — so a wrong value here yields a wrongly-scaled shot.
   */
  natural: { width: number; height: number };
};

const captchaThemes = ['defaults', ...Object.keys(themes)];

/**
 * Prop resolvers only. The matching component map lives in Shot.svelte: routes.ts
 * is plain TS run by Bun and can't import a .svelte file, so the two halves are
 * keyed by the same name rather than living in one table.
 */
export const subjects: Record<string, ShotSubject> = {
  captcha: {
    // The track is 44px tall in MochiCaptcha's own CSS; 416 is a comfortable slider width.
    natural: { width: 416, height: 44 },
    props: (url) => {
      const theme = url.searchParams.get('theme') ?? 'defaults';
      if (!captchaThemes.includes(theme)) {
        error(400, `No captcha theme '${theme}'. Known: ${captchaThemes.join(', ')}`);
      }
      return { captcha: mintCaptcha(), theme };
    },
  },

  // Carries no wrapper: it's already a default-imported .svelte, so Shot.svelte can
  // hydrate it directly. Its natural box is the bare button's own intrinsic size,
  // measured in the browser — nothing here constrains it, so a guess would mis-scale.
  like: {
    natural: { width: 31, height: 19 },
    props: () => ({ initialLikes: 42 }),
  },

  // The blur beside the image it resolves to. Unlike every other subject this one is
  // rendered SSR-only in Shot.svelte — <Image> ships no client JS, so there's nothing
  // to hydrate. Measured, not guessed: two 600x400 `hero` boxes plus the arrow and
  // its gaps.
  'image-placeholder': {
    natural: { width: 1264, height: 400 },
    props: () => ({ src: 'https://sta-public.fra1.cdn.digitaloceanspaces.com/mochi/mochi-1.jpg' }),
  },
};

/**
 * Fraction of the frame the subject grows to fill. Short of 1 so the component
 * doesn't collide with the edges of the shot.
 */
const FILL = 0.9;

/**
 * Largest uniform scale that still fits, i.e. `fit: inside` — the same contain
 * semantics as the image `sizes` in index.ts. Uniform because the alternative is
 * stretching each axis to the frame, which distorts any subject whose aspect ratio
 * isn't the frame's (the captcha is ~9.5:1 against a 16:9 canvas).
 */
export function fitScale(frame: { width: number; height: number }, natural: { width: number; height: number }): number {
  return Math.min(frame.width / natural.width, frame.height / natural.height) * FILL;
}

export const SCHEMES = ['light', 'dark'] as const;

export type Scheme = (typeof SCHEMES)[number];

/**
 * Null rather than a throw on a bad value: this is read from the handle too, which
 * only picks a stamp and must never fail. The route turns null into the 400.
 * Light by default — it's the scheme the components' own CSS fallbacks are written for.
 */
export function readScheme(query: URLSearchParams): Scheme | null {
  const scheme = query.get('scheme') ?? 'light';
  return SCHEMES.includes(scheme as Scheme) ? (scheme as Scheme) : null;
}

export const DEFAULT_WIDTH = 1280;

const ASPECT = 9 / 16;

const clamp = (n: number) => Math.min(Math.max(Math.round(n), 64), 4096);

/** Height follows 16:9 off the width unless given explicitly, so `?w=1920` stays widescreen. */
export function frameSize(query: URLSearchParams): { width: number; height: number } {
  const asInt = (raw: string | null) => {
    if (raw === null) {
      return null;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      error(400, `Expected a positive number, got '${raw}'`);
    }
    return n;
  };

  const width = clamp(asInt(query.get('w')) ?? DEFAULT_WIDTH);
  return { width, height: clamp(asInt(query.get('h')) ?? width * ASPECT) };
}
