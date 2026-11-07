import { GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import { fontFile } from '../lib/fontFile.ts';
import { DISPLAY_AXES, WORDMARK_SIZE, WORDMARK_TRACKING_EM } from './brand.ts';

// Private family names so nothing resolves through the system font list — Alpine ships none.
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
 * The only place `ctx.font` is set. A bare `ctx.font` is wrong for Fraunces twice over: the CSS
 * weight doesn't drive the `wght` axis (it defaults to 900), and `opsz` stays at 9 instead of
 * tracking the font size the way `font-optical-sizing: auto` does in a browser.
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

export const WORDMARK: FontSpec = { family: FRAUNCES, size: WORDMARK_SIZE, tracking: WORDMARK_TRACKING_EM, ...DISPLAY_AXES };

export const LEDE: FontSpec = { family: FRAUNCES, size: 48, tracking: -0.003, wght: 400 };

export const DEK: FontSpec = { family: FRAUNCES, size: 29.6, italic: true, tracking: 0.003, wght: 300 };

// JetBrains Mono stands in for the reference capture's ui-monospace; same 0.6em advance.
export const URL: FontSpec = { family: MONO, size: 22.4, tracking: 0.04 };
