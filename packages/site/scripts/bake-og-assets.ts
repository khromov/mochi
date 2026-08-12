/**
 * Bakes the two OG-card assets that can't be produced at runtime: the `feTurbulence` grain tile and
 * the dango emoji. The production image is Alpine — no browser, no emoji font — so both are captured
 * here from a real Chrome and committed. Re-run only when the card's design changes.
 *
 *   bun --cwd=packages/site scripts/bake-og-assets.ts
 */
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { launch, type LaunchedChrome } from 'chrome-launcher';
import CDP from 'chrome-remote-interface';
import { NOISE_SVG, NOISE_TILE_SIZE } from '../src/og/brand.ts';

const ASSETS_DIR = path.join(import.meta.dir, '..', 'src', 'og', 'assets');

type Rect = { x: number; y: number; width: number; height: number };

const page = (body: string, style = '') =>
  `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}${style}</style>${body}`)}`;

async function withPage<T>(port: number, url: string, fn: (client: CDP.Client) => Promise<T>): Promise<T> {
  const target = await CDP.New({ port, url: 'about:blank' });
  const client = await CDP({ port, target });
  try {
    const { Page, Emulation } = client;
    await Page.enable();
    // Without this the screenshot gets Chrome's opaque white base layer instead of alpha.
    await Emulation.setDefaultBackgroundColorOverride({ color: { r: 0, g: 0, b: 0, a: 0 } });
    const loaded = Page.loadEventFired();
    await Page.navigate({ url });
    await loaded;
    await client.Runtime.evaluate({ expression: 'document.fonts.ready', awaitPromise: true });
    return await fn(client);
  } finally {
    await client.close();
    await CDP.Close({ port, id: target.id });
  }
}

async function shoot(client: CDP.Client, clip: Rect, scale: number): Promise<Buffer> {
  const { data } = await client.Page.captureScreenshot({
    format: 'png',
    captureBeyondViewport: true,
    clip: { ...clip, scale },
  });
  return Buffer.from(data, 'base64');
}

async function bakeNoise(port: number): Promise<void> {
  const url = page(
    `<div id="t"></div>`,
    `#t{width:${NOISE_TILE_SIZE}px;height:${NOISE_TILE_SIZE}px;background-image:url("data:image/svg+xml;utf8,${NOISE_SVG.replace(/%/g, '%25').replace(/#/g, '%23')}");background-size:${NOISE_TILE_SIZE}px ${NOISE_TILE_SIZE}px}`,
  );
  await withPage(port, url, async (client) => {
    const png = await shoot(client, { x: 0, y: 0, width: NOISE_TILE_SIZE, height: NOISE_TILE_SIZE }, 1);
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

let chrome: LaunchedChrome | undefined;
try {
  await mkdir(ASSETS_DIR, { recursive: true });
  chrome = await launch({
    chromeFlags: ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1'],
  });
  await bakeNoise(chrome.port);
  await fetchDango();
} finally {
  await chrome?.kill();
}
