/**
 * Bakes the two OG-card assets that can't be produced at runtime: the `feTurbulence` grain tile and
 * the dango emoji. The production image is Alpine — no browser, no emoji font — so both are captured
 * here from a real Chrome and committed. Re-run only when the card's design changes.
 *
 *   bun --cwd=packages/site scripts/bake-og-assets.ts
 */
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { NOISE_SVG, NOISE_TILE_SIZE } from '../src/og/brand.ts';

const ASSETS_DIR = path.join(import.meta.dir, '..', 'src', 'og', 'assets');

/** GitHub Actions runners can't initialize Chrome's sandbox; CI needs these flags for Chrome to launch. */
const CHROME_BACKEND = { type: 'chrome', argv: ['--no-sandbox', '--disable-dev-shm-usage'] } as const;

type Rect = { x: number; y: number; width: number; height: number };

const page = (body: string, style = '') =>
  `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}${style}</style>${body}`)}`;

async function withPage<T>(url: string, fn: (view: Bun.WebView) => Promise<T>): Promise<T> {
  const view = new Bun.WebView({ backend: CHROME_BACKEND });
  try {
    // cdp() needs a session, and the first navigate is what establishes one.
    await view.navigate('about:blank');
    // Without this the screenshot gets Chrome's opaque white base layer instead of alpha.
    await view.cdp('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    await view.navigate(url);
    await view.evaluate('document.fonts.ready');
    return await fn(view);
  } finally {
    view.close();
  }
}

// view.screenshot() exposes neither `clip` nor `captureBeyondViewport`, so this one stays on the raw CDP command.
async function shoot(view: Bun.WebView, clip: Rect, scale: number): Promise<Buffer> {
  const { data } = await view.cdp<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { ...clip, scale },
  });
  return Buffer.from(data, 'base64');
}

async function bakeNoise(): Promise<void> {
  const url = page(
    `<div id="t"></div>`,
    `#t{width:${NOISE_TILE_SIZE}px;height:${NOISE_TILE_SIZE}px;background-image:url("data:image/svg+xml;utf8,${NOISE_SVG.replace(/%/g, '%25').replace(/#/g, '%23')}");background-size:${NOISE_TILE_SIZE}px ${NOISE_TILE_SIZE}px}`,
  );
  await withPage(url, async (view) => {
    const png = await shoot(view, { x: 0, y: 0, width: NOISE_TILE_SIZE, height: NOISE_TILE_SIZE }, 1);
    await Bun.write(path.join(ASSETS_DIR, 'noise-240.png'), png);
    console.log(`noise-240.png  ${NOISE_TILE_SIZE}×${NOISE_TILE_SIZE}  ${png.byteLength} B`);
  });
}

/**
 * The dango is fetched rather than screenshotted — it can only come from a colour-emoji font, which
 * neither CI nor the Alpine runtime has. Pinned to the last gradient-shaded `google/noto-emoji`
 * (Apache-2.0) release: `main` carries the flat redesign, whose shading reads noticeably differently
 * from the card this replaces. That tag only publishes 128px, which is the size the card draws at.
 */
const DANGO_SOURCE = 'https://raw.githubusercontent.com/googlefonts/noto-emoji/v2020-09-16-unicode13_1/png/128/emoji_u1f361.png';

async function fetchDango(): Promise<void> {
  const response = await fetch(DANGO_SOURCE);
  if (!response.ok) {
    throw new Error(`${DANGO_SOURCE} → ${response.status}`);
  }
  const png = Buffer.from(await response.arrayBuffer());
  await Bun.write(path.join(ASSETS_DIR, 'dango.png'), png);
  console.log(`dango.png      from noto-emoji  ${png.byteLength} B`);
}

try {
  await mkdir(ASSETS_DIR, { recursive: true });
  await bakeNoise();
  await fetchDango();
} finally {
  Bun.WebView.closeAll();
}
