/**
 * The card's design tokens, lifted verbatim from the CSS that produced `public/og-default.png`
 * (`OgPage.svelte`, and the `.hero` rule in `shell.html`). The canvas renderer and the asset-baking
 * script both read from here so the two can't drift.
 */

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

export const GRADIENT_FROM = '#2b3d33';
export const GRADIENT_TO = '#4a7c59';
export const GRADIENT_ANGLE_DEG = 135;

export const NOISE_TILE_SIZE = 240;

/** The `feTurbulence` layer blended over the gradient at `soft-light`. */
export const NOISE_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='${NOISE_TILE_SIZE}' height='${NOISE_TILE_SIZE}'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`;

/** The brand heading recipe repeated across the site's headings; `opsz 144` is Fraunces' display cut. */
export const DISPLAY_AXES = { opsz: 144, SOFT: 50, WONK: 1, wght: 400 } as const;

export const WORDMARK_WORD = 'mochi';

/** `.og-logo` — 8rem, `letter-spacing: -0.015em`. */
export const WORDMARK_SIZE = 128;
export const WORDMARK_TRACKING_EM = -0.015;

export const INK = '#fff';
export const INK_MUTED = '#e0e8e2';
export const INK_FAINT = 'rgba(224, 232, 226, 0.7)';

export const SITE_HOST = 'mochi.fast';
