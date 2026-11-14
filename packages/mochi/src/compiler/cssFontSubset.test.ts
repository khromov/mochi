import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { parseCss, type CssDocument } from './cssAst';
import { MochiCookieJar } from '../runtime/cookies';
import { requestContext } from '../runtime/requestContext';

const FIXTURE = path.join(import.meta.dir, '..', '__fixtures__', 'fonts', 'caveat-latin-wght-normal.woff2');
const TEXT = "It's animated!";

// Mirrors the shape @fontsource-variable ships: one face per script, ranged, variable, with the `-variations` hint.
const CAVEAT_CSS = `@font-face {
  font-family: 'Caveat Variable';
  font-style: normal;
  font-display: swap;
  font-weight: 400 700;
  src: url(./files/caveat-cyrillic-wght-normal.woff2) format('woff2-variations');
  unicode-range: U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116;
}
@font-face {
  font-family: 'Caveat Variable';
  font-style: normal;
  font-display: swap;
  font-weight: 400 700;
  src: url(./files/caveat-latin-wght-normal.woff2) format('woff2-variations');
  unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;
}
`;

function page(body: string, script: string): string {
  return `<script>\n${script}\n<` + `/script>\n\n${body}\n`;
}

async function render(registry: ComponentRegistry, pagePath: string) {
  const ctx = {
    requestId: 'test',
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
    params: {},
    locals: {},
    isWarmup: false,
    cookies: new MochiCookieJar(null),
    islandProps: new Map(),
    getClientAddress: () => null,
  };
  return requestContext.run(ctx, () => registry.renderComponent(pagePath));
}

describe('CSS imports — font subsetting via import attributes', () => {
  let tmp: string;
  let outDir: string;
  let registry: ComponentRegistry;
  const pages = { svelte: '', script: '', noClosure: '', invalid: '', otherAttributes: '' };

  function bundledCss(): { css: string; document: CssDocument } {
    const urls = registry.toManifest().importedCssUrls ?? {};
    const key = Object.keys(urls).find((k) => k.endsWith('caveat.css'));
    expect(key).toBeDefined();
    const css = registry.getClientFile(urls[key!]!);
    expect(css).toBeDefined();
    const document = parseCss(css!);
    expect(document).not.toBeNull();
    return { css: css!, document: document! };
  }

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-font-subset-test-'));
    outDir = path.join(tmp, 'out');
    mkdirSync(path.join(tmp, 'files'));
    copyFileSync(FIXTURE, path.join(tmp, 'files', 'caveat-latin-wght-normal.woff2'));
    copyFileSync(FIXTURE, path.join(tmp, 'files', 'caveat-cyrillic-wght-normal.woff2'));
    writeFileSync(path.join(tmp, 'caveat.css'), CAVEAT_CSS);

    pages.svelte = path.join(tmp, 'SveltePage.svelte');
    writeFileSync(pages.svelte, page(`<p class="note">${TEXT}</p>`, `  import './caveat.css' with { subset: "${TEXT}", weight: '500' };`));

    writeFileSync(path.join(tmp, 'fonts.ts'), `import './caveat.css' with { subset: 'Hello', weight: '500' };\nexport const loaded = true;\n`);
    pages.script = path.join(tmp, 'ScriptPage.svelte');
    writeFileSync(pages.script, page(`<p>Hello {loaded}</p>`, `  import { loaded } from './fonts.ts';`));

    pages.noClosure = path.join(tmp, 'NoClosurePage.svelte');
    writeFileSync(pages.noClosure, page(`<p>${TEXT}</p>`, `  import './caveat.css' with { subset: "${TEXT}", weight: '500', layoutClosure: 'none' };`));

    pages.invalid = path.join(tmp, 'InvalidPage.svelte');
    writeFileSync(pages.invalid, page(`<p>x</p>`, `  import './caveat.css' with { subset: 'x', wieght: '500' };`));

    // Bun's own attributes on a non-stylesheet import, in a module that also subsets a font.
    writeFileSync(path.join(tmp, 'data.json'), '{"ok":true}');
    pages.otherAttributes = path.join(tmp, 'OtherAttributesPage.svelte');
    writeFileSync(
      pages.otherAttributes,
      page(`<p>{data.ok}</p>`, `  import './caveat.css' with { subset: 'Hello', weight: '500' };\n  import data from './data.json' with { type: 'json', embed: 'true' };`),
    );

    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(pages.svelte);
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('a .svelte import attribute subsets the latin face, pins the weight, and drops the face the text never touches', () => {
    const { css, document } = bundledCss();
    expect(document.fontFaces).toHaveLength(1);
    expect(css).not.toContain('U+0400-045F');
    expect(css).toContain('font-weight:500');
    const [source] = document.fontFaces[0]!.sources;
    expect(source!.format).toBe('woff2');
    const [url, asset] = [...registry.getFontAssets()][0]!;
    expect(url.startsWith('/_mochi/fonts/caveat-latin-wght-normal-')).toBe(true);
    expect(url.endsWith('.woff2')).toBe(true);
    expect(readFileSync(asset.diskPath).length).toBe(5388);
    expect(source!.url!.value).toBe(url);
  });

  test('the served subset is preloaded and the dev-check faces name the family with the kept codepoints', async () => {
    const result = await render(registry, pages.svelte);
    expect(result.fontPreloadUrls).toEqual([[...registry.getFontAssets().keys()][0]!]);
    expect(result.fontSubsetFaces).toEqual([{ family: 'Caveat Variable', ranges: expect.arrayContaining([{ lo: 0x49, hi: 0x49 }]) }]);
  });

  test('a second page importing through a .ts module widens the shared subset and re-bundles the stylesheet', async () => {
    const before = registry.toManifest().importedCssUrls!;
    const oldFontUrl = [...registry.getFontAssets().keys()][0]!;
    await registry.compile(pages.script);
    const after = registry.toManifest().importedCssUrls!;
    expect(Object.values(after)).not.toEqual(Object.values(before));
    // The earlier page's next render links the widened bundle, and HTML already in a browser can still fetch the old file.
    const newUrl = (await render(registry, pages.svelte)).fontPreloadUrls[0]!;
    expect(newUrl).not.toBe(oldFontUrl);
    expect((await render(registry, pages.script)).fontPreloadUrls).toEqual([newUrl]);
    expect(readFileSync(registry.getFontAsset(newUrl)!.diskPath).length).toBeGreaterThan(5388);
    expect(registry.getFontAsset(oldFontUrl)).toBeDefined();
  });

  test('an unchanged request does not re-bundle', async () => {
    const before = registry.toManifest().importedCssUrls!;
    await registry.compile(pages.svelte, { force: true });
    expect(registry.toManifest().importedCssUrls!).toEqual(before);
  });

  test('a site dropping layout closure shares the face of the sites that keep it, rather than adding one the browser cannot tell apart', async () => {
    const before = registry.toManifest().importedCssUrls!;
    await registry.compile(pages.noClosure);
    expect(registry.toManifest().importedCssUrls!).toEqual(before);
    expect(bundledCss().document.fontFaces).toHaveLength(1);
  });

  test('attributes on an import that is not a stylesheet are left to the runtime', async () => {
    await registry.compile(pages.otherAttributes);
    expect(registry.getErrors()).toEqual([]);
  });

  test('a typo in an attribute is a compile error naming the file and line, not a silently full-size font', async () => {
    await registry.compile(pages.invalid);
    const error = registry.getErrors().find((e) => e.kind === 'font-subset-invalid');
    expect(error).toMatchObject({ kind: 'font-subset-invalid', filePath: pages.invalid, specifier: './caveat.css', line: 2 });
    expect((error as { message: string }).message).toContain('"wieght"');
    // Fixing the file clears it on the next compile.
    writeFileSync(pages.invalid, page(`<p>x</p>`, `  import './caveat.css' with { subset: 'x', weight: '500' };`));
    await registry.compile(pages.invalid, { force: true });
    expect(registry.getErrors().find((e) => e.kind === 'font-subset-invalid')).toBeUndefined();
  });
});
