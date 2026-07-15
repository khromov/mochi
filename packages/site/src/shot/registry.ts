import { error, mintCaptcha } from 'mochi-framework';
import { themes } from '../demos/captcha-styling/themes';

export type ShotSubject = {
  /** Resolved per request, server-side — same contract as a page's serverProps. */
  props: (url: URL) => Record<string, unknown>;
};

const captchaThemes = ['defaults', ...Object.keys(themes)];

/**
 * Prop resolvers only. The matching component map lives in Shot.svelte: routes.ts
 * is plain TS run by Bun and can't import a .svelte file, so the two halves are
 * keyed by the same name rather than living in one table.
 */
export const subjects: Record<string, ShotSubject> = {
  captcha: {
    props: (url) => {
      const theme = url.searchParams.get('theme') ?? 'defaults';
      if (!captchaThemes.includes(theme)) {
        error(400, `No captcha theme '${theme}'. Known: ${captchaThemes.join(', ')}`);
      }
      return { captcha: mintCaptcha(), theme };
    },
  },
};

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
