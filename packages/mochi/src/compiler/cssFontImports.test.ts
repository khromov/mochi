import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { fontContentHash } from './cssFontAssets';

function fakeFont(size: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = (i * 31 + seed) % 256;
  }
  return bytes;
}

// End-to-end through a real Bun.build: Bun inlines the fonts as data: URIs, the framework decodes the large ones back
// out into served binaries. Fixtures are generated (binary font payloads don't belong in git).
describe('CSS imports — font asset extraction', () => {
  let tmp: string;
  let outDir: string;
  let registry: ComponentRegistry;
  let pagePath: string;
  const woff2 = fakeFont(10_000, 1);
  const woff = fakeFont(12_000, 2);
  const smallWoff2 = fakeFont(1024, 3);

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-font-extract-test-'));
    outDir = path.join(tmp, 'out');
    const filesDir = path.join(tmp, 'files');
    mkdirSync(filesDir);
    writeFileSync(path.join(filesDir, 'demo-latin-400-normal.woff2'), woff2);
    writeFileSync(path.join(filesDir, 'demo-latin-400-normal.woff'), woff);
    writeFileSync(path.join(filesDir, 'demo-icons.woff2'), smallWoff2);
    writeFileSync(
      path.join(tmp, 'fonts.css'),
      `@font-face {
  font-family: 'Demo';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('./files/demo-latin-400-normal.woff2') format('woff2'), url('./files/demo-latin-400-normal.woff') format('woff');
  unicode-range: U+0000-00FF;
}
@font-face {
  font-family: 'Demo Icons';
  src: url('./files/demo-icons.woff2') format('woff2');
}`,
    );
    // A second stylesheet referencing the same font file: its extraction yields the same content-hashed URL, so the
    // page's preload list must dedupe it.
    writeFileSync(
      path.join(tmp, 'shared.css'),
      `@font-face {
  font-family: 'Demo Duplicate';
  src: url('./files/demo-latin-400-normal.woff2') format('woff2');
  unicode-range: U+0000-00FF;
}`,
    );
    pagePath = path.join(tmp, 'FontExtractPage.svelte');
    writeFileSync(pagePath, `<script>\n  import './fonts.css';\n  import './shared.css';\n<` + `/script>\n\n<h1>font-extract-fixture</h1>\n`);

    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(pagePath);
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function bundledCss(): string {
    const cssOutput = registry.getClientStats()?.outputs.find((o) => o.name.startsWith('fonts-') && o.name.endsWith('.css'));
    expect(cssOutput).toBeDefined();
    const cssText = registry.getClientFile(`/_mochi/import-css/${cssOutput!.name}`);
    expect(cssText).toBeDefined();
    return cssText!;
  }

  test('rewrites the large woff2 to a served font URL and drops the base64 payload', () => {
    const css = bundledCss();
    // Bun unquotes the plain `woff2` format keyword — both forms are valid CSS.
    expect(css).toMatch(new RegExp(`url\\(/_mochi/fonts/demo-latin-400-normal-${fontContentHash(woff2)}\\.woff2\\) format\\(["']?woff2["']?\\)`));
  });

  test('drops the legacy woff source entirely', () => {
    const css = bundledCss();
    expect(css).not.toMatch(/format\(["']?woff["']?\)/);
    expect(css).not.toContain('data:font/woff;');
  });

  test('keeps the small icon font inlined', () => {
    const css = bundledCss();
    expect(css).toContain('data:font/woff2;base64,');
    expect(registry.getFontAsset(`/_mochi/fonts/demo-icons-${fontContentHash(smallWoff2)}.woff2`)).toBeUndefined();
  });

  test('serves the extracted bytes from disk via getFontAsset', () => {
    const url = `/_mochi/fonts/demo-latin-400-normal-${fontContentHash(woff2)}.woff2`;
    const asset = registry.getFontAsset(url);
    expect(asset).toBeDefined();
    expect(asset!.contentType).toBe('font/woff2');
    expect(existsSync(asset!.diskPath)).toBe(true);
    expect(readFileSync(asset!.diskPath).equals(woff2)).toBe(true);
  });

  test('a font shared by two stylesheets appears once in the stats', () => {
    const name = `fonts/demo-latin-400-normal-${fontContentHash(woff2)}.woff2`;
    expect(registry.getClientStats()!.outputs.filter((o) => o.name === name)).toHaveLength(1);
  });

  test('renderComponent surfaces the latin face as a single deduped preload URL', async () => {
    const { requestContext } = await import('../runtime/requestContext');
    const { MochiCookieJar } = await import('../runtime/cookies');
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
    const result = await requestContext.run(ctx, () => registry.renderComponent(pagePath));
    expect(result.fontPreloadUrls).toEqual([`/_mochi/fonts/demo-latin-400-normal-${fontContentHash(woff2)}.woff2`]);
  });

  test('manifest round-trip restores font assets and preload URLs', async () => {
    const manifest = registry.toManifest();
    expect(Object.keys(manifest.fontAssets ?? {})).toHaveLength(1);
    const manifestPath = path.join(outDir, 'manifest.json');
    await Bun.write(manifestPath, JSON.stringify(manifest));
    const restored = await ComponentRegistry.fromManifest(manifestPath, false);

    const url = `/_mochi/fonts/demo-latin-400-normal-${fontContentHash(woff2)}.woff2`;
    const asset = restored.getFontAsset(url);
    expect(asset).toBeDefined();
    expect(readFileSync(asset!.diskPath).equals(woff2)).toBe(true);
    expect(restored.toManifest().importedCssFontPreloads).toEqual(manifest.importedCssFontPreloads);
  });
});

describe('CSS imports — font byte changes and re-bundles', () => {
  let tmp: string;
  let registry: ComponentRegistry;
  const bytesA = fakeFont(9_000, 7);
  const bytesB = fakeFont(9_000, 8);

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-font-rebundle-test-'));
    const filesDir = path.join(tmp, 'files');
    mkdirSync(filesDir);
    writeFileSync(path.join(filesDir, 'brand.woff2'), bytesA);
    writeFileSync(path.join(tmp, 'fonts.css'), `@font-face { font-family: 'Brand'; src: url('./files/brand.woff2') format('woff2'); }`);
    const pagePath = path.join(tmp, 'RebundlePage.svelte');
    writeFileSync(pagePath, `<script>\n  import './fonts.css';\n<` + `/script>\n\n<h1>rebundle-fixture</h1>\n`);
    registry = new ComponentRegistry({ development: true, outDir: path.join(tmp, 'out') });
    await registry.compile(pagePath);
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  const importCssUrls = () => [...registry.getClientFiles().keys()].filter((u) => u.includes('/import-css/'));

  test('a font-only change renames the imported-CSS URL and keeps the old font URL resolvable', async () => {
    const [cssUrlA] = importCssUrls();
    expect(cssUrlA).toBeDefined();
    const fontUrlA = `/_mochi/fonts/brand-${fontContentHash(bytesA)}.woff2`;
    expect(registry.getClientFile(cssUrlA!)).toContain(fontUrlA);

    writeFileSync(path.join(tmp, 'files', 'brand.woff2'), bytesB);
    await registry.rebundleImportedCss();

    // Same source CSS, new font bytes: the immutable stylesheet URL must change with the font URL baked into it.
    const [cssUrlB] = importCssUrls();
    expect(cssUrlB).toBeDefined();
    expect(cssUrlB).not.toBe(cssUrlA);
    const fontUrlB = `/_mochi/fonts/brand-${fontContentHash(bytesB)}.woff2`;
    expect(registry.getClientFile(cssUrlB!)).toContain(fontUrlB);

    // Already-rendered dev HTML still resolves the superseded font URL; the manifest carries only the live one.
    expect(registry.getFontAsset(fontUrlA)).toBeDefined();
    expect(registry.getFontAsset(fontUrlB)).toBeDefined();
    expect(Object.keys(registry.toManifest().fontAssets ?? {})).toEqual([fontUrlB]);
  });
});

describe('CSS imports — fonts option overrides', () => {
  let tmp: string;
  const font = fakeFont(10_000, 4);

  beforeAll(() => {
    tmp = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-font-optout-test-'));
    const filesDir = path.join(tmp, 'files');
    mkdirSync(filesDir);
    writeFileSync(path.join(filesDir, 'plain.woff2'), font);
    writeFileSync(path.join(tmp, 'fonts.css'), `@font-face { font-family: 'P'; src: url('./files/plain.woff2') format('woff2'); }`);
    writeFileSync(path.join(tmp, 'OptOutPage.svelte'), `<script>\n  import './fonts.css';\n<` + `/script>\n\n<h1>opt-out-fixture</h1>\n`);
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('inlineThreshold: Infinity keeps every font inlined', async () => {
    const registry = new ComponentRegistry({ development: true, outDir: path.join(tmp, 'out'), fonts: { inlineThreshold: Infinity } });
    await registry.compile(path.join(tmp, 'OptOutPage.svelte'));
    const cssOutput = registry.getClientStats()?.outputs.find((o) => o.name.startsWith('fonts-'));
    const cssText = registry.getClientFile(`/_mochi/import-css/${cssOutput!.name}`)!;
    expect(cssText).toContain('data:font/woff2;base64,');
    expect(registry.toManifest().fontAssets).toBeUndefined();
  });
});

// Real @fontsource files, because the interesting case is Bun's own 128 kB copy threshold (oven-sh/bun#24599): at or
// above it the bundler writes the font next to the stylesheet instead of inlining it, whatever `inlineThreshold` says.
describe('CSS imports — fonts across Bun’s 128 kB copy threshold', () => {
  const fixtures = path.join(import.meta.dir, '..', '__fixtures__', 'fonts');
  const largeBytes = new Uint8Array(readFileSync(path.join(fixtures, 'fraunces-latin-full-italic.woff2')));
  const smallBytes = new Uint8Array(readFileSync(path.join(fixtures, 'jetbrains-mono-latin-400-normal.woff2')));
  const largeUrl = `/_mochi/fonts/fraunces-latin-full-italic-${fontContentHash(largeBytes)}.woff2`;
  const smallUrl = `/_mochi/fonts/jetbrains-mono-latin-400-normal-${fontContentHash(smallBytes)}.woff2`;
  let tmp: string;
  let pagePath: string;

  beforeAll(() => {
    expect(largeBytes.length).toBeGreaterThanOrEqual(128 * 1024);
    expect(smallBytes.length).toBeLessThan(128 * 1024);
    tmp = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-font-threshold-test-'));
    const filesDir = path.join(tmp, 'files');
    mkdirSync(filesDir);
    cpSync(path.join(fixtures, 'fraunces-latin-full-italic.woff2'), path.join(filesDir, 'fraunces-latin-full-italic.woff2'));
    cpSync(path.join(fixtures, 'jetbrains-mono-latin-400-normal.woff2'), path.join(filesDir, 'jetbrains-mono-latin-400-normal.woff2'));
    writeFileSync(
      path.join(tmp, 'fonts.css'),
      `@font-face {
  font-family: 'Fraunces';
  font-style: italic;
  src: url('./files/fraunces-latin-full-italic.woff2') format('woff2-variations');
  unicode-range: U+0000-00FF;
}
@font-face {
  font-family: 'JetBrains Mono';
  font-weight: 400;
  src: url('./files/jetbrains-mono-latin-400-normal.woff2') format('woff2');
  unicode-range: U+0000-00FF;
}`,
    );
    pagePath = path.join(tmp, 'ThresholdPage.svelte');
    writeFileSync(pagePath, `<script>\n  import './fonts.css';\n<` + `/script>\n\n<h1>threshold-fixture</h1>\n`);
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  async function compile(name: string, fonts?: { inlineThreshold: number }): Promise<{ registry: ComponentRegistry; css: string; outDir: string }> {
    const outDir = path.join(tmp, name);
    const registry = new ComponentRegistry({ development: true, outDir, ...(fonts ? { fonts } : {}) });
    await registry.compile(pagePath);
    expect(registry.getErrors()).toEqual([]);
    const cssOutput = registry.getClientStats()!.outputs.find((o) => o.name.startsWith('fonts-') && o.name.endsWith('.css'));
    return { registry, css: registry.getClientFile(`/_mochi/import-css/${cssOutput!.name}`)!, outDir };
  }

  function expectServed(registry: ComponentRegistry, url: string, bytes: Uint8Array): void {
    const asset = registry.getFontAsset(url);
    expect(asset).toBeDefined();
    expect(asset!.contentType).toBe('font/woff2');
    expect(readFileSync(asset!.diskPath).equals(bytes)).toBe(true);
  }

  test('extracts both fonts under the default threshold', async () => {
    const { registry, css, outDir } = await compile('out-default');

    expect(css).toContain(largeUrl);
    expect(css).toContain(smallUrl);
    expect(css).not.toContain('data:font');
    expect(css).not.toMatch(/url\(["']?\.?\.?\/?[\w-]+\.woff2["']?\)/);
    expectServed(registry, largeUrl, largeBytes);
    expectServed(registry, smallUrl, smallBytes);
    // Nothing of Bun's own making is left beside the stylesheet, where no route would serve it.
    expect(readdirSync(path.join(outDir, 'import-css')).filter((f) => f.endsWith('.woff2'))).toEqual([]);
  });

  test('inlineThreshold: Infinity still extracts the font Bun refuses to inline', async () => {
    const { registry, css, outDir } = await compile('out-infinity', { inlineThreshold: Infinity });

    expect(css).toContain(`data:font/woff2;base64,${Buffer.from(smallBytes).toString('base64')}`);
    expect(css).toContain(largeUrl);
    expect(registry.getFontAsset(smallUrl)).toBeUndefined();
    expectServed(registry, largeUrl, largeBytes);
    expect(readdirSync(path.join(outDir, 'import-css')).filter((f) => f.endsWith('.woff2'))).toEqual([]);
  });

  // Letting the plugin decline a font Bun would copy segfaults the bundler, which takes this whole file down with it.
  test('a threshold above 128 kB extracts the large font instead of declining it', async () => {
    const { registry, css } = await compile('out-high', { inlineThreshold: 512 * 1024 });

    expect(css).toContain(`data:font/woff2;base64,${Buffer.from(smallBytes).toString('base64')}`);
    expect(css).toContain(largeUrl);
    expectServed(registry, largeUrl, largeBytes);
  });

  test('an adopted font still preloads and round-trips through the manifest', async () => {
    const { registry, outDir } = await compile('out-manifest', { inlineThreshold: Infinity });
    const { requestContext } = await import('../runtime/requestContext');
    const { MochiCookieJar } = await import('../runtime/cookies');
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
    const result = await requestContext.run(ctx, () => registry.renderComponent(pagePath));
    expect(result.fontPreloadUrls).toEqual([largeUrl]);

    const manifestPath = path.join(outDir, 'manifest.json');
    await Bun.write(manifestPath, JSON.stringify(registry.toManifest()));
    const restored = await ComponentRegistry.fromManifest(manifestPath, false);
    expectServed(restored, largeUrl, largeBytes);
  });
});

// Bun's 128 kB copy threshold applies to every `url()`, not just fonts: a large image is written beside the stylesheet
// and referenced relatively, so it has to be served from where that relative URL lands.
describe('CSS imports — non-font assets Bun emits', () => {
  const fixtures = path.join(import.meta.dir, '..', '__fixtures__', 'images');
  const largeBytes = new Uint8Array(readFileSync(path.join(fixtures, 'large.png')));
  const smallBytes = new Uint8Array(readFileSync(path.join(fixtures, 'small.png')));
  let tmp: string;
  let registry: ComponentRegistry;
  let outDir: string;
  let cssUrl: string;

  beforeAll(async () => {
    expect(largeBytes.length).toBeGreaterThanOrEqual(128 * 1024);
    expect(smallBytes.length).toBeLessThan(128 * 1024);
    tmp = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-css-image-test-'));
    outDir = path.join(tmp, 'out');
    const filesDir = path.join(tmp, 'files');
    mkdirSync(filesDir);
    cpSync(path.join(fixtures, 'large.png'), path.join(filesDir, 'large.png'));
    cpSync(path.join(fixtures, 'small.png'), path.join(filesDir, 'small.png'));
    writeFileSync(path.join(tmp, 'images.css'), `.hero { background-image: url('./files/large.png'); }\n.icon { background-image: url('./files/small.png'); }`);
    const pagePath = path.join(tmp, 'ImagePage.svelte');
    writeFileSync(pagePath, `<script>\n  import './images.css';\n<` + `/script>\n\n<h1>image-fixture</h1>\n`);
    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(pagePath);
    expect(registry.getErrors()).toEqual([]);
    cssUrl = `/_mochi/import-css/${registry.getClientStats()!.outputs.find((o) => o.name.startsWith('images-') && o.name.endsWith('.css'))!.name}`;
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('serves the large image at the URL the stylesheet resolves to', () => {
    const css = registry.getClientFile(cssUrl)!;
    const relative = css.match(/url\(["']?([^"')]*large[^"')]*\.png)["']?\)/)?.[1];
    expect(relative).toBeDefined();

    const resolved = new URL(relative!, `http://localhost${cssUrl}`).pathname;
    const asset = registry.getImportedCssAsset(resolved);
    expect(asset).toBeDefined();
    expect(asset!.contentType).toBe('image/png');
    expect(readFileSync(asset!.diskPath).equals(largeBytes)).toBe(true);
  });

  test('leaves the small image inlined, with nothing to serve', () => {
    const css = registry.getClientFile(cssUrl)!;
    expect(css).toContain(`data:image/png;base64,${Buffer.from(smallBytes).toString('base64')}`);
    expect(css).not.toMatch(/url\(["']?[^"')]*small[^"')]*\.png["']?\)/);
    expect(readdirSync(path.join(outDir, 'import-css')).filter((f) => f.endsWith('.png'))).toHaveLength(1);
  });

  test('round-trips through the manifest', async () => {
    const css = registry.getClientFile(cssUrl)!;
    const resolved = new URL(css.match(/url\(["']?([^"')]*large[^"')]*\.png)["']?\)/)![1]!, `http://localhost${cssUrl}`).pathname;
    const manifestPath = path.join(outDir, 'manifest.json');
    await Bun.write(manifestPath, JSON.stringify(registry.toManifest()));
    const restored = await ComponentRegistry.fromManifest(manifestPath, false);

    const asset = restored.getImportedCssAsset(resolved);
    expect(asset).toBeDefined();
    expect(readFileSync(asset!.diskPath).equals(largeBytes)).toBe(true);
  });
});
