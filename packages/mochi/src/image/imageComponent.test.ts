import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from '../Mochi';
import { withExifOrientation } from './__testUtils__/exif';

const GLOBAL_LOCAL_ASSETS_KEY = '__mochi_local_image_assets__';
const RM_OPTS = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 } as const;

const PAGE_SRC = `<script>
  import { Image } from 'mochi-framework/image';
  import local from './portrait.jpg';
  let { portrait, rotated } = $props();
</script>
<Image src={portrait} size="hero" placeholder alt="portrait" />
<Image src={rotated} size="hero" alt="rotated" />
<Image src={local} size="hero" alt="local" />
<Image src={local} size="raw" alt="local-raw" />
`;

function imgTag(html: string, alt: string): string {
  const tag = html.match(new RegExp(`<img[^>]*alt="${alt}"[^>]*>`))?.[0];
  if (!tag) {
    throw new Error(`no <img alt="${alt}"> in:\n${html}`);
  }
  return tag;
}

function dims(tag: string): { width: string | undefined; height: string | undefined } {
  return { width: tag.match(/\swidth="(\d+)"/)?.[1], height: tag.match(/\sheight="(\d+)"/)?.[1] };
}

// `<Image>`'s `<img width/height>` must carry the served image's aspect ratio, not the size's declared box: under
// `fit: 'inside'` a 2:3 source in a 600×400 box is served at 267×400, and a 3:2 box would reserve (and paint the
// placeholder into) the wrong shape until the image loads.
describe('<Image> reserves the served aspect ratio', () => {
  let fixtureDir: string;
  let outDir: string;
  let origin: Server<undefined>;
  let server: Server<undefined>;
  let base: string;

  beforeAll(async () => {
    const tiny = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    const portrait = await new Bun.Image(tiny).resize(40, 60, { fit: 'fill' }).jpeg().bytes();
    // Stored landscape, displayed portrait: EXIF orientation 6 rotates it 90°.
    const rotated = withExifOrientation(await new Bun.Image(tiny).resize(60, 40, { fit: 'fill' }).jpeg().bytes(), 6);
    origin = Bun.serve({
      port: 0,
      fetch: (req) => new Response(new URL(req.url).pathname === '/rotated.jpg' ? rotated : new Uint8Array(portrait), { headers: { 'content-type': 'image/jpeg' } }),
    });

    fixtureDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-image-dims-fix-'));
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-image-dims-out-'));
    writeFileSync(path.join(fixtureDir, 'portrait.jpg'), portrait);
    const pagePath = path.join(fixtureDir, 'Page.svelte');
    writeFileSync(pagePath, PAGE_SRC);

    server = await Mochi.serve({
      port: 0,
      development: false,
      warmup: false,
      logger: { enabled: false },
      outDir,
      image: {
        blockPrivateNetworks: false,
        cacheDir: path.join(outDir, 'image-cache'),
        sizes: { hero: { width: 600, height: 400, fit: 'inside' }, raw: { width: 300, autoOrient: false } },
      },
      routes: {
        '/': Mochi.page(pagePath, {
          serverProps: () => ({ portrait: `http://127.0.0.1:${origin.port}/portrait.jpg`, rotated: `http://127.0.0.1:${origin.port}/rotated.jpg` }),
        }),
      },
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    server?.stop(true);
    origin?.stop(true);
    delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_LOCAL_ASSETS_KEY];
    rmSync(fixtureDir, RM_OPTS);
    rmSync(outDir, RM_OPTS);
  });

  const render = async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    return res.text();
  };

  test('a local import is sized from its intrinsic dimensions on the first render', async () => {
    expect(dims(imgTag(await render(), 'local'))).toEqual({ width: '267', height: '400' });
  });

  // With `autoOrient: false` the intrinsic (EXIF-oriented) size can't predict the variant, so nothing is known yet.
  test('an unpredictable width-only size keeps its declared width rather than the import intrinsic one', async () => {
    expect(dims(imgTag(await render(), 'local-raw')).width).toBe('300');
  });

  test('a remote portrait falls back to the declared box while cold, then matches its blur placeholder', async () => {
    expect(dims(imgTag(await render(), 'portrait'))).toEqual({ width: '600', height: '400' });

    // The cold render warms the placeholder in the background, which caches the original and its dimensions.
    let tag = '';
    for (let i = 0; i < 100 && !tag.includes('background-image'); i++) {
      await Bun.sleep(50);
      tag = imgTag(await render(), 'portrait');
    }
    expect(tag).toContain('background-image');
    expect(dims(tag)).toEqual({ width: '267', height: '400' });
  });

  test('an EXIF-rotated remote source is sized by the variant the endpoint actually served', async () => {
    const src = imgTag(await render(), 'rotated')
      .match(/\ssrc="([^"]+)"/)![1]!
      .replaceAll('&amp;', '&');
    const variant = await fetch(`${base}${src}`);
    expect(variant.status).toBe(200);
    expect(await new Bun.Image(new Uint8Array(await variant.arrayBuffer())).metadata()).toMatchObject({ width: 267, height: 400 });

    expect(dims(imgTag(await render(), 'rotated'))).toEqual({ width: '267', height: '400' });
  });
});
