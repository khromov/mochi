import { GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import { fontFile } from '../lib/fontFile.ts';
import { DISPLAY_AXES, WORDMARK_SIZE, WORDMARK_TRACKING_EM } from './brand.ts';

/**
 * Registered under private family names so nothing here can accidentally resolve through the system
 * font list — Alpine, the production base image, ships none.
 */
export const FRAUNCES = 'OG Fraunces';
export const MONO = 'OG Mono';

GlobalFonts.registerFromPath(fontFile('@fontsource-variable/fraunces', 'fraunces-latin-full-normal.woff2'), FRAUNCES);
GlobalFonts.registerFromPath(fontFile('@fontsource-variable/fraunces', 'fraunces-latin-full-italic.woff2'), FRAUNCES);
GlobalFonts.registerFromPath(fontFile('@fontsource/jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff2'), MONO);

export interface FontSpec {
  family: string;
  size: number;
  italic?: boolean;
  /** Tracking in em, matching the CSS `letter-spacing` it came from. */
  tracking?: number;
  wght?: number;
  opsz?: number;
  SOFT?: number;
  WONK?: number;
}

/**
 * The only place `ctx.font` is set. Two Skia behaviours make a bare `ctx.font` wrong for Fraunces:
 * the CSS weight in the shorthand doesn't drive the `wght` axis (the face defaults to 900), and the
 * `opsz` axis stays at its 9 minimum instead of tracking the font size the way `font-optical-sizing:
 * auto` does in a browser. Both are pinned explicitly here.
 */
export function applyFont(ctx: SKRSContext2D, spec: FontSpec): void {
  ctx.font = `${spec.italic ? 'italic ' : ''}${spec.size}px "${spec.family}"`;
  ctx.letterSpacing = `${(spec.tracking ?? 0) * spec.size}px`;
  ctx.fontVariationSettings =
    spec.family === FRAUNCES
      ? Object.entries({ wght: spec.wght ?? 400, opsz: spec.opsz ?? spec.size, SOFT: spec.SOFT ?? 0, WONK: spec.WONK ?? 1 })
          .map(([axis, value]) => `"${axis}" ${value}`)
          .join(', ')
      : '';
}

/** `.og-logo` — 8rem Fraunces on the brand display axes. */
export const WORDMARK: FontSpec = { family: FRAUNCES, size: WORDMARK_SIZE, tracking: WORDMARK_TRACKING_EM, ...DISPLAY_AXES };

/** `.og-lede` — 3rem, the slot the dynamic title also uses. */
export const LEDE: FontSpec = { family: FRAUNCES, size: 48, tracking: -0.003, wght: 400 };

/** `.og-dek` — 1.85rem italic. */
export const DEK: FontSpec = { family: FRAUNCES, size: 29.6, italic: true, tracking: 0.003, wght: 300 };

/** `.og-url` — 1.4rem mono. The reference used the browser's `ui-monospace`; JetBrains Mono has the
 * same 0.6em advance, so the band lands within a pixel. */
export const URL: FontSpec = { family: MONO, size: 22.4, tracking: 0.04 };
