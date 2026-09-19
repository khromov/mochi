import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { parseCss } from './compiler/cssAst';

const FIXTURE = path.join(import.meta.dir, '__fixtures__', 'fonts', 'caveat-latin-wght-normal.woff2');
const TEXT = "It's animated!";

/** `href`s of the `<link>`s matching `selector`, read with Bun's HTML parser rather than by eye. */
async function linkHrefs(html: string, selector: string): Promise<string[]> {
  const hrefs: string[] = [];
  const rewriter = new HTMLRewriter().on(selector, {
    element(element) {
      hrefs.push(element.getAttribute('href') ?? '');
    },
  });
  await rewriter.transform(new Response(html)).text();
  return hrefs;
}

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
    const href = (await linkHrefs(html, 'link[rel="stylesheet"]')).find((url) => url.includes('/import-css/'));
    expect(href).toBeDefined();
    return (await fetch(`${base}${href}`)).text();
  }

  test('a subset under the inline threshold ships inside the stylesheet: no font request, no preload', async () => {
    expect(await linkHrefs(inlinedHtml, 'link[rel="preload"][as="font"]')).toEqual([]);
    const css = await stylesheet(inlinedHtml);
    const document = parseCss(css)!;
    expect(document.fontFaces[0]!.sources[0]!.url!.value.startsWith('data:font/woff2;base64,')).toBe(true);
    expect(document.urls.some((url) => url.value.startsWith('/_mochi/fonts/'))).toBe(false);
    expect(css).toContain('font-weight:500');
  });

  test('a larger subset is served as a content-hashed file and preloaded', async () => {
    const [preload] = await linkHrefs(servedHtml, 'link[rel="preload"][as="font"]');
    expect(preload).toBeDefined();
    expect(preload!.startsWith('/_mochi/fonts/caveat-latin-wght-normal-')).toBe(true);
    expect(preload!.endsWith('.woff2')).toBe(true);
    const css = await stylesheet(servedHtml);
    expect(parseCss(css)!.fontFaces[0]!.sources[0]!.url!.value).toBe(preload!);
    const font = await fetch(`${base}${preload}`);
    expect(font.status).toBe(200);
    expect(font.headers.get('content-type')).toContain('font/woff2');
    expect((await font.bytes()).length).toBe(8160);
  });

  test('dev pages carry the browser-side missing-glyph check with the page family ranges', () => {
    for (const html of [inlinedHtml, servedHtml]) {
      expect(html).toContain('window.__mochi_font_subsets={"caveat variable":[[');
      expect(html).toContain('font subset for');
    }
  });
});
