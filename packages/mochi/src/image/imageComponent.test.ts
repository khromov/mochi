import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from '../Mochi';
import { invalidateImage } from './imageApi';

const GLOBAL_LOCAL_ASSETS_KEY = '__mochi_local_image_assets__';
const RM_OPTS = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 } as const;

const PAGE_SRC = `<script>
  import { Image } from 'mochi-framework/image';
  import local from './portrait.jpg';
  let { remote } = $props();
</script>
<Image src={remote} size="hero" placeholder alt="remote" />
<Image src={local} size="hero" alt="local" />
<Image src={local} size="wide" alt="local-wide" />
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

// Under `fit: 'inside'` a 2:3 source in a 600×400 box is served at 267×400; once that variant is cached, `<Image>` must
// reserve its real shape rather than the declared 3:2 box.
describe('<Image> width/height', () => {
  let fixtureDir: string;
  let outDir: string;
  let origin: Server<undefined>;
  let server: Server<undefined>;
  let base: string;
  let upstream: Uint8Array;

  beforeAll(async () => {
    const tiny = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    const portrait = await new Bun.Image(tiny).resize(40, 60, { fit: 'fill' }).jpeg().bytes();
    upstream = portrait;
    origin = Bun.serve({ port: 0, fetch: () => new Response(new Uint8Array(upstream), { headers: { 'content-type': 'image/jpeg' } }) });

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
        sizes: { hero: { width: 600, height: 400, fit: 'inside' }, wide: { width: 300 } },
      },
      routes: {
        '/': Mochi.page(pagePath, { serverProps: () => ({ remote: `http://127.0.0.1:${origin.port}/remote.jpg` }) }),
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

  const fetchVariant = async (tag: string) => {
    const src = tag.match(/\ssrc="([^"]+)"/)![1]!.replaceAll('&amp;', '&');
    const res = await fetch(`${base}${src}`);
    expect(res.status).toBe(200);
    return new Bun.Image(new Uint8Array(await res.arrayBuffer())).metadata();
  };

  test('a remote portrait reserves the declared box while cold, then the served size once its variant is cached', async () => {
    const cold = imgTag(await render(), 'remote');
    expect(dims(cold)).toEqual({ width: '600', height: '400' });

    expect(await fetchVariant(cold)).toMatchObject({ width: 267, height: 400 });
    expect(dims(imgTag(await render(), 'remote'))).toEqual({ width: '267', height: '400' });
  });

  test('a local import does the same', async () => {
    const cold = imgTag(await render(), 'local');
    expect(dims(cold)).toEqual({ width: '600', height: '400' });

    await fetchVariant(cold);
    expect(dims(imgTag(await render(), 'local'))).toEqual({ width: '267', height: '400' });
  });

  test('a cold width-only size keeps its declared width rather than the import intrinsic one', async () => {
    const cold = imgTag(await render(), 'local-wide');
    expect(dims(cold)).toEqual({ width: '300', height: undefined });

    await fetchVariant(cold);
    expect(dims(imgTag(await render(), 'local-wide'))).toEqual({ width: '300', height: '450' });
  });

  test('a hard invalidation drops the old dimensions until the new variant is served', async () => {
    upstream = await new Bun.Image(upstream).resize(60, 20, { fit: 'fill' }).jpeg().bytes();
    const remote = `http://127.0.0.1:${origin.port}/remote.jpg`;
    await invalidateImage(remote, { hard: true });

    const cold = imgTag(await render(), 'remote');
    expect(dims(cold)).toEqual({ width: '600', height: '400' });
    await fetchVariant(cold);
    expect(dims(imgTag(await render(), 'remote'))).toEqual({ width: '600', height: '200' });
  });
});
