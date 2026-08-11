import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    pagePath = path.join(tmp, 'FontExtractPage.svelte');
    writeFileSync(pagePath, `<script>\n  import './fonts.css';\n<` + `/script>\n\n<h1>font-extract-fixture</h1>\n`);

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

  test('renderComponent surfaces the latin face as a preload URL', async () => {
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
