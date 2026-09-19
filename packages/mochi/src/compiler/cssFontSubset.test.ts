import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { MochiCookieJar } from '../runtime/cookies';
import { requestContext } from '../runtime/requestContext';

const FIXTURE = path.join(import.meta.dir, '..', '__fixtures__', 'fonts', 'caveat-latin-wght-normal.woff2');
const SOURCE_SIZE = 74932;
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
  const pages = { svelte: '', script: '', noClosure: '', invalid: '' };

  function bundledCss(): string {
    const urls = registry.toManifest().importedCssUrls ?? {};
    const key = Object.keys(urls).find((k) => k.endsWith('caveat.css'));
    expect(key).toBeDefined();
    const css = registry.getClientFile(urls[key!]!);
    expect(css).toBeDefined();
    return css!;
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

    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(pages.svelte);
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('a .svelte import attribute subsets the latin face, pins the weight, and drops the face the text never touches', () => {
    const css = bundledCss();
    expect(css.match(/@font-face/g)).toHaveLength(1);
    expect(css).not.toContain('U+0400-045F');
    expect(css).toContain('font-weight:500');
    expect(css).toMatch(/format\(["']?woff2["']?\)/);
    expect(css).not.toContain('woff2-variations');
    const [url, asset] = [...registry.getFontAssets()][0]!;
    expect(url).toMatch(/^\/_mochi\/fonts\/caveat-latin-wght-normal-[0-9a-f]{8}\.woff2$/);
    expect(asset.subsetOf).toBe(SOURCE_SIZE);
    expect(readFileSync(asset.diskPath).length).toBe(5388);
    expect(css).toContain(`url(${url})`);
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
    const asset = registry.getFontAsset(newUrl)!;
    expect(asset.subsetOf).toBe(SOURCE_SIZE);
    expect(readFileSync(asset.diskPath).length).toBeGreaterThan(5388);
    expect(registry.getFontAsset(oldFontUrl)).toBeDefined();
  });

  test('an unchanged request does not re-bundle', async () => {
    const before = registry.toManifest().importedCssUrls!;
    await registry.compile(pages.svelte, { force: true });
    expect(registry.toManifest().importedCssUrls!).toEqual(before);
  });

  test('a site dropping layout closure gets its own face, small enough to inline, beside the shared one', async () => {
    await registry.compile(pages.noClosure);
    const css = bundledCss();
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css.match(/url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\)/g)).toHaveLength(1);
    expect(css.match(/url\(\/_mochi\/fonts\//g)).toHaveLength(1);
    const result = await render(registry, pages.noClosure);
    expect(result.fontPreloadUrls).toHaveLength(1);
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

  test('the manifest carries the subset provenance and restores it', async () => {
    const manifest = registry.toManifest();
    const entries = Object.entries(manifest.fontAssets ?? {});
    expect(entries.length).toBeGreaterThan(0);
    for (const [, asset] of entries) {
      expect(asset.subsetOf).toBe(SOURCE_SIZE);
    }
    const manifestPath = path.join(outDir, 'manifest.json');
    await Bun.write(manifestPath, JSON.stringify(manifest));
    const restored = await ComponentRegistry.fromManifest(manifestPath, false);
    expect(restored.getFontAsset(entries[0]![0])?.subsetOf).toBe(SOURCE_SIZE);
  });

  test('fonts.subset: false ships the full font and ignores the attributes', async () => {
    const off = new ComponentRegistry({ development: true, outDir: path.join(tmp, 'out-off'), fonts: { subset: false } });
    await off.compile(pages.svelte);
    const fonts = [...off.getFontAssets()];
    expect(fonts).toHaveLength(2);
    for (const [, asset] of fonts) {
      expect(asset.subsetOf).toBeUndefined();
      expect(readFileSync(asset.diskPath).length).toBe(SOURCE_SIZE);
    }
    expect((await render(off, pages.svelte)).fontSubsetFaces).toBeUndefined();
  });
});
