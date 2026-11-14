import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { parseCss, type CssDocument } from './cssAst';
import { logger } from '../utils/log';
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
  const pages = { svelte: '', alike: '', script: '', closure: '', plain: '', mixed: '', invalid: '', otherAttributes: '' };

  async function stylesheetUrl(from: ComponentRegistry, pagePath: string): Promise<string> {
    const url = (await render(from, pagePath)).cssUrls.find((u) => u.includes('/import-css/'));
    expect(url).toBeDefined();
    return url!;
  }

  async function bundledCss(pagePath: string): Promise<{ css: string; document: CssDocument }> {
    const css = registry.getClientFile(await stylesheetUrl(registry, pagePath));
    expect(css).toBeDefined();
    const document = parseCss(css!);
    expect(document).not.toBeNull();
    return { css: css!, document: document! };
  }

  function write(name: string, body: string, script: string): string {
    const file = path.join(tmp, name);
    writeFileSync(file, page(body, script));
    return file;
  }

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-font-subset-test-'));
    outDir = path.join(tmp, 'out');
    mkdirSync(path.join(tmp, 'files'));
    copyFileSync(FIXTURE, path.join(tmp, 'files', 'caveat-latin-wght-normal.woff2'));
    copyFileSync(FIXTURE, path.join(tmp, 'files', 'caveat-cyrillic-wght-normal.woff2'));
    writeFileSync(path.join(tmp, 'caveat.css'), CAVEAT_CSS);

    pages.svelte = write('SveltePage.svelte', `<p class="note">${TEXT}</p>`, `  import './caveat.css' with { subset: "${TEXT}", weight: '500' };`);
    // The same glyphs in another order: the same request.
    pages.alike = write('AlikePage.svelte', `<p>${TEXT}</p>`, `  import './caveat.css' with { subset: "${[...TEXT].reverse().join('')}", weight: '500' };`);

    writeFileSync(path.join(tmp, 'fonts.ts'), `import './caveat.css' with { subset: 'Hello', weight: '500' };\nexport const loaded = true;\n`);
    pages.script = write('ScriptPage.svelte', `<p>Hello {loaded}</p>`, `  import { loaded } from './fonts.ts';`);

    write('NoClosure.svelte', `<p>${TEXT}</p>`, `  import './caveat.css' with { subset: "${TEXT}", weight: '500', layoutClosure: 'none' };`);
    pages.closure = write(
      'ClosurePage.svelte',
      `<NoClosure />`,
      `  import NoClosure from './NoClosure.svelte';\n  import './caveat.css' with { subset: "${TEXT}", weight: '500' };`,
    );

    pages.plain = write('PlainPage.svelte', `<p>Anything at all</p>`, `  import './caveat.css';`);
    pages.mixed = write('MixedPage.svelte', `<NoClosure />`, `  import NoClosure from './NoClosure.svelte';\n  import './caveat.css';`);

    pages.invalid = write('InvalidPage.svelte', `<p>x</p>`, `  import './caveat.css' with { subset: 'x', wieght: '500' };`);

    // Bun's own attributes on a non-stylesheet import, in a module that also subsets a font.
    writeFileSync(path.join(tmp, 'data.json'), '{"ok":true}');
    pages.otherAttributes = write(
      'OtherAttributesPage.svelte',
      `<p>{data.ok}</p>`,
      `  import './caveat.css' with { subset: 'Hello', weight: '500' };\n  import data from './data.json' with { type: 'json', embed: 'true' };`,
    );

    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(pages.svelte);
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('a .svelte import attribute subsets the latin face, pins the weight, and drops the face the text never touches', async () => {
    const { css, document } = await bundledCss(pages.svelte);
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

  test('a page asking for other text, through a .ts module, gets a stylesheet and font of its own and leaves the first page alone', async () => {
    const first = await stylesheetUrl(registry, pages.svelte);
    await registry.compile(pages.script);
    expect(await stylesheetUrl(registry, pages.svelte)).toBe(first);
    expect(await stylesheetUrl(registry, pages.script)).not.toBe(first);
    // Five glyphs fit under the inline threshold, so this page's font rides in its stylesheet while the first page's is still served.
    const { document } = await bundledCss(pages.script);
    expect(document.fontFaces).toHaveLength(1);
    expect(document.fontFaces[0]!.sources[0]!.url!.value.startsWith('data:font/woff2;base64,')).toBe(true);
    expect((await render(registry, pages.script)).fontPreloadUrls).toEqual([]);
    expect((await render(registry, pages.svelte)).fontPreloadUrls).toHaveLength(1);
  });

  test('pages asking for the same glyphs share one stylesheet and one font', async () => {
    await registry.compile(pages.alike);
    expect(await stylesheetUrl(registry, pages.alike)).toBe(await stylesheetUrl(registry, pages.svelte));
    expect(registry.getFontAssets().size).toBe(1);
  });

  test('an unchanged request does not re-bundle', async () => {
    const before = registry.toManifest().importedCssUrls!;
    // The URLs are content-hashed and so would survive a re-bundle; the subset log line is what a re-bundle adds.
    const info = spyOn(logger, 'info').mockImplementation(() => {});
    try {
      await registry.compile(pages.svelte, { force: true });
      expect(info.mock.calls.filter((call) => String(call[0]).startsWith('font subset:'))).toEqual([]);
    } finally {
      info.mockRestore();
    }
    expect(registry.toManifest().importedCssUrls!).toEqual(before);
  });

  test('editing the attribute in a module that holds nothing but the import recompiles its page', async () => {
    const onlyFonts = path.join(tmp, 'only-fonts.ts');
    writeFileSync(onlyFonts, `import './caveat.css' with { subset: 'Before', weight: '500' };\n`);
    const host = write('OnlyFontsPage.svelte', `<p>Before</p>`, `  import './only-fonts.ts';`);
    await registry.compile(host);
    const before = await stylesheetUrl(registry, host);
    writeFileSync(onlyFonts, `import './caveat.css' with { subset: 'After', weight: '500' };\n`);
    expect((await registry.recompileChanged(onlyFonts)).pages).toEqual(new Set([host]));
    expect(await stylesheetUrl(registry, host)).not.toBe(before);
  });

  test('an importer that cannot be parsed ships the whole font and says so', async () => {
    writeFileSync(path.join(tmp, 'deferred.ts'), `export const value = 1;\n`);
    // Bun compiles import defer; acorn does not read it yet.
    writeFileSync(
      path.join(tmp, 'unreadable.ts'),
      `import './caveat.css' with { subset: 'x', weight: '500' };\nimport defer * as ns from './deferred.ts';\nexport const value = () => ns.value;\n`,
    );
    const host = write('UnreadablePage.svelte', `<p>{value()}</p>`, `  import { value } from './unreadable.ts';`);
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      await registry.compile(host);
      expect(registry.getErrors()).toEqual([]);
      expect(await stylesheetUrl(registry, host)).toBe(await stylesheetUrl(registry, pages.plain));
      const warnings = warn.mock.calls.map((call) => String(call[0])).filter((message) => message.includes('could not be parsed'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('unreadable.ts');
    } finally {
      warn.mockRestore();
    }
  });

  test('imports on one page that disagree on layout closure share a face that keeps it, and say so once', async () => {
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      await registry.compile(pages.closure);
      // Same weight and glyphs as the first page, closure kept: the very same bundle.
      expect(await stylesheetUrl(registry, pages.closure)).toBe(await stylesheetUrl(registry, pages.svelte));
      expect((await bundledCss(pages.closure)).document.fontFaces).toHaveLength(1);
      const warnings = warn.mock.calls.map((call) => String(call[0])).filter((message) => message.includes('different subsetting'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('NoClosure.svelte (weight 500, no layout closure)');
      expect(warnings[0]).toContain('ClosurePage.svelte (weight 500)');
      expect(warnings[0]).not.toContain('\\');
      await registry.compile(pages.closure, { force: true });
      expect(warn.mock.calls.filter((call) => String(call[0]).includes('different subsetting'))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  test('a plain import ships the whole font, also beside a subset import on the same page, where it warns', async () => {
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      await registry.compile(pages.plain);
      expect(warn.mock.calls.filter((call) => String(call[0]).includes('different subsetting'))).toHaveLength(0);
      const { css, document } = await bundledCss(pages.plain);
      expect(document.fontFaces).toHaveLength(2);
      expect(css).toContain('font-weight:400 700');
      const wholeFonts = (await render(registry, pages.plain)).fontPreloadUrls.map((url) => readFileSync(registry.getFontAsset(url)!.diskPath).length);
      expect(wholeFonts).toEqual([SOURCE_SIZE]);

      await registry.compile(pages.mixed);
      expect(await stylesheetUrl(registry, pages.mixed)).toBe(await stylesheetUrl(registry, pages.plain));
      const warnings = warn.mock.calls.map((call) => String(call[0])).filter((message) => message.includes('different subsetting'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('MixedPage.svelte (no subset)');
      expect(warnings[0]).toContain('ships the whole font');
      // The page that subsets on its own is untouched by the plain imports elsewhere.
      expect((await bundledCss(pages.svelte)).document.fontFaces).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  test('an import a page drops stops counting towards its font', async () => {
    const dropped = write('DroppingPage.svelte', `<NoClosure />`, `  import NoClosure from './NoClosure.svelte';\n  import './caveat.css' with { subset: 'Zq', weight: '700' };`);
    await registry.compile(dropped);
    expect((await bundledCss(dropped)).document.fontFaces).toHaveLength(2);
    writeFileSync(dropped, page(`<p>Zq</p>`, `  import './caveat.css' with { subset: 'Zq', weight: '700' };`));
    await registry.compile(dropped, { force: true });
    const { css, document } = await bundledCss(dropped);
    expect(document.fontFaces).toHaveLength(1);
    expect(css).toContain('font-weight:700');
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

  test('after a manifest boot, compiling another page reuses a matching bundle and leaves the built pages their own', async () => {
    const manifestPath = path.join(outDir, 'manifest.json');
    await Bun.write(manifestPath, JSON.stringify(registry.toManifest()));
    const restored = await ComponentRegistry.fromManifest(manifestPath, false);
    const built = await stylesheetUrl(restored, pages.svelte);
    const builtCss = restored.getClientFile(built);

    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const sameRequest = write('LazyAlikePage.svelte', `<p>${TEXT}</p>`, `  import './caveat.css' with { subset: "${TEXT}", weight: '500' };`);
      await restored.compile(sameRequest);
      expect(await stylesheetUrl(restored, sameRequest)).toBe(built);

      const otherRequest = write('LazyOtherPage.svelte', `<p>Lazy</p>`, `  import './caveat.css' with { subset: 'Lazy', weight: '500' };`);
      await restored.compile(otherRequest);
      expect(await stylesheetUrl(restored, otherRequest)).not.toBe(built);
    } finally {
      warn.mockRestore();
    }
    expect(await stylesheetUrl(restored, pages.svelte)).toBe(built);
    expect(restored.getClientFile(built)).toBe(builtCss!);

    // A dev boot from the same manifest can still re-bundle the subset after a .css edit.
    const dev = await ComponentRegistry.fromManifest(manifestPath, true);
    await dev.rebundleImportedCss();
    expect(dev.getErrors()).toEqual([]);
    expect(dev.getClientFile(await stylesheetUrl(dev, pages.svelte))).toBe(builtCss!);
  });

  test('several variants of one stylesheet bundle in a single batch', async () => {
    const batch = new ComponentRegistry({ development: false, outDir: path.join(tmp, 'out-batch') });
    const entries = [pages.svelte, pages.script, pages.plain, pages.alike, pages.otherAttributes];
    await batch.compileAll(entries);
    expect(batch.getErrors()).toEqual([]);
    const urls = await Promise.all(entries.map((entry) => stylesheetUrl(batch, entry)));
    expect(new Set(urls).size).toBe(3);
    for (const url of urls) {
      expect(parseCss(batch.getClientFile(url)!)!.fontFaces.length).toBeGreaterThan(0);
    }
  });
});
