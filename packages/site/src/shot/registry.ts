import { error, mintCaptcha } from 'mochi-framework';
import { themes } from '../demos/captcha-styling/themes';

export type ShotSubject = {
  // Resolved per request, server-side — same contract as a page's serverProps.
  props: (url: URL) => Record<string, unknown>;
  // Sole source of truth for the subject's width; the frame scales up from it, so a wrong value mis-scales the shot.
  natural: { width: number; height: number };
};

const captchaThemes = ['defaults', ...Object.keys(themes)];

// The matching component map lives in Shot.svelte, not here, since routes.ts is plain TS
// run by Bun and can't import a .svelte file; the two halves are keyed by the same name.
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

  // No wrapper needed since it's already a default-imported .svelte; natural is the
  // button's measured intrinsic size, since nothing here constrains it and a guess would mis-scale.
  like: {
    natural: { width: 31, height: 19 },
    props: () => ({ initialLikes: 42 }),
  },

  // Rendered SSR-only in Shot.svelte since <Image> ships no client JS; natural is measured
  // (two 600x400 `hero` boxes plus the arrow and its gaps), not guessed.
  'image-placeholder': {
    natural: { width: 1264, height: 400 },
    props: () => ({ src: 'https://sta-public.fra1.cdn.digitaloceanspaces.com/mochi/mochi-1.jpg' }),
  },
};

// Short of 1 so the subject doesn't collide with the shot's edges.
const FILL = 0.9;

/** Largest uniform scale that fits inside the frame (`fit: inside` semantics); uniform
 * because stretching each axis would distort subjects whose aspect ratio isn't the frame's. */
export function fitScale(frame: { width: number; height: number }, natural: { width: number; height: number }): number {
  return Math.min(frame.width / natural.width, frame.height / natural.height) * FILL;
}

export const SCHEMES = ['light', 'dark'] as const;

export type Scheme = (typeof SCHEMES)[number];

/** Returns null (not a throw) on a bad value since the handle also reads this and must
 * never fail; the route turns null into the 400. Defaults to light, the scheme the components' CSS fallbacks assume. */
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
