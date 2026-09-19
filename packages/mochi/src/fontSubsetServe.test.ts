import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

const FIXTURE = path.join(import.meta.dir, '__fixtures__', 'fonts', 'caveat-latin-wght-normal.woff2');
const TEXT = "It's animated!";

// End to end through Mochi.serve in dev: what the browser receives for a subset that inlines, and for one that is served.
describe('font subsetting through Mochi.serve', () => {
  let server: Server<undefined>;
  let tmp: string;
  let base: string;
  let inlinedHtml: string;
  let servedHtml: string;

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-font-subset-serve-'));
    mkdirSync(path.join(tmp, 'files'));
    copyFileSync(FIXTURE, path.join(tmp, 'files', 'caveat-latin-wght-normal.woff2'));
    // One stylesheet per page: requests for a shared stylesheet merge app-wide, which is a registry-level concern.
    for (const name of ['inlined', 'served']) {
      writeFileSync(
        path.join(tmp, `${name}.css`),
        `@font-face {\n  font-family: 'Caveat Variable';\n  font-weight: 400 700;\n  src: url(./files/caveat-latin-wght-normal.woff2) format('woff2-variations');\n}\n`,
      );
    }
    writeFileSync(
      path.join(tmp, 'Inlined.svelte'),
      `<script>\n  import './inlined.css' with { subset: "${TEXT}", weight: '500', layoutClosure: 'none' };\n<` +
        `/script>\n<p style="font-family: 'Caveat Variable'">${TEXT}</p>\n`,
    );
    writeFileSync(
      path.join(tmp, 'Served.svelte'),
      `<script>\n  import './served.css' with { subset: "${TEXT}" };\n<` + `/script>\n<p style="font-family: 'Caveat Variable'">${TEXT}</p>\n`,
    );
    server = await Mochi.serve({
      port: 0,
      development: true,
      logger: { enabled: false },
      outDir: path.join(tmp, 'out'),
      routes: { '/inlined': Mochi.page(path.join(tmp, 'Inlined.svelte')), '/served': Mochi.page(path.join(tmp, 'Served.svelte')) },
    });
    base = `http://localhost:${server.port}`;
    inlinedHtml = await (await fetch(`${base}/inlined`)).text();
    servedHtml = await (await fetch(`${base}/served`)).text();
  });

  afterAll(() => {
    server.stop(true);
    rmSync(tmp, { recursive: true, force: true });
  });

  async function stylesheet(html: string): Promise<string> {
    const href = html.match(/<link rel="stylesheet" href="([^"]+import-css[^"]+)"/)?.[1];
    expect(href).toBeDefined();
    return (await fetch(`${base}${href}`)).text();
  }

  test('a subset under the inline threshold ships inside the stylesheet: no font request, no preload', async () => {
    expect(inlinedHtml).not.toContain('rel="preload" as="font"');
    const css = await stylesheet(inlinedHtml);
    expect(css).toMatch(/url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\)/);
    expect(css).not.toContain('/_mochi/fonts/');
    expect(css).toContain('font-weight:500');
  });

  test('a larger subset is served as a content-hashed file and preloaded', async () => {
    const preload = servedHtml.match(/<link rel="preload" as="font"[^>]*href="([^"]+)"/)?.[1];
    expect(preload).toMatch(/^\/_mochi\/fonts\/caveat-latin-wght-normal-[0-9a-f]{8}\.woff2$/);
    const css = await stylesheet(servedHtml);
    expect(css).toContain(`url(${preload})`);
    const font = await fetch(`${base}${preload}`);
    expect(font.status).toBe(200);
    expect(font.headers.get('content-type')).toContain('font/woff2');
    expect((await font.bytes()).length).toBe(8160);
  });

  test('dev pages carry the browser-side missing-glyph check for the subsetted family', () => {
    expect(inlinedHtml).toContain('font subset for');
    expect(inlinedHtml).toContain('"caveat variable":[[');
    expect(servedHtml).toContain('font subset for');
  });
});
