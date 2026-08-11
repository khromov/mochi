import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { extractFontAssets, fontContentHash, scanFontSourceNames } from './cssFontAssets';

function dataUri(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

function fakeFont(size: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = (i * 31 + seed) % 256;
  }
  return bytes;
}

const OPTS = {
  inlineThreshold: 4096,
  dropLegacyWoff: true,
  urlFor: (fileName: string) => `/_mochi/fonts/${fileName}`,
};

describe('extractFontAssets', () => {
  test('extracts a large inlined woff2 into a hashed asset and rewrites the url', () => {
    const font = fakeFont(10_000, 1);
    const css = `@font-face {\n  font-family: Demo;\n  src: url("${dataUri('font/woff2', font)}") format("woff2");\n}`;
    const { css: out, assets } = extractFontAssets(css, OPTS);

    expect(assets).toHaveLength(1);
    const asset = assets[0]!;
    expect(asset.contentType).toBe('font/woff2');
    expect(asset.fileName).toBe(`font-${fontContentHash(font)}.woff2`);
    expect(asset.bytes).toEqual(font);
    expect(asset.preload).toBe(true);
    expect(out).toContain(`url(/_mochi/fonts/${asset.fileName}) format("woff2")`);
    expect(out).not.toContain('base64');
  });

  test('leaves fonts at or below the threshold inlined', () => {
    const css = `@font-face { font-family: Icons; src: url("${dataUri('font/woff2', fakeFont(2048, 2))}") format("woff2"); }`;
    const { css: out, assets } = extractFontAssets(css, OPTS);
    expect(assets).toHaveLength(0);
    expect(out).toBe(css);
  });

  test('Infinity threshold restores full inlining', () => {
    const css = `@font-face { font-family: Demo; src: url("${dataUri('font/woff2', fakeFont(50_000, 3))}") format("woff2"); }`;
    const { css: out, assets } = extractFontAssets(css, { ...OPTS, inlineThreshold: Infinity });
    expect(assets).toHaveLength(0);
    expect(out).toBe(css);
  });

  test('drops legacy woff sources when the face also offers woff2', () => {
    const woff2 = fakeFont(9000, 4);
    const woff = fakeFont(11_000, 5);
    const css = `@font-face {\n  font-family: Demo;\n  src: url("${dataUri('font/woff2', woff2)}") format("woff2"), url("${dataUri('font/woff', woff)}") format("woff");\n}`;
    const { css: out, assets } = extractFontAssets(css, OPTS);

    expect(assets).toHaveLength(1);
    expect(assets[0]!.fileName).toEndWith('.woff2');
    expect(out).not.toContain('format("woff")');
  });

  test('keeps woff when it is the only format and dropLegacyWoff stays off for woff-only faces', () => {
    const woff = fakeFont(9000, 6);
    const css = `@font-face { font-family: Old; src: url("${dataUri('font/woff', woff)}") format("woff"); }`;
    const { assets } = extractFontAssets(css, OPTS);
    expect(assets).toHaveLength(1);
    expect(assets[0]!.fileName).toEndWith('.woff');
  });

  test('dropLegacyWoff: false keeps both formats as separate assets', () => {
    const woff2 = fakeFont(9000, 7);
    const woff = fakeFont(11_000, 8);
    const css = `@font-face { font-family: Demo; src: url("${dataUri('font/woff2', woff2)}") format("woff2"), url("${dataUri('font/woff', woff)}") format("woff"); }`;
    const { css: out, assets } = extractFontAssets(css, { ...OPTS, dropLegacyWoff: false });
    expect(assets).toHaveLength(2);
    expect(out).toContain('format("woff")');
  });

  test('non-latin unicode-range faces are extracted but not preloaded', () => {
    const font = fakeFont(9000, 9);
    const css = `@font-face {\n  font-family: Demo;\n  src: url("${dataUri('font/woff2', font)}") format("woff2");\n  unicode-range: U+0400-045F, U+0490-0491;\n}`;
    const { assets } = extractFontAssets(css, OPTS);
    expect(assets).toHaveLength(1);
    expect(assets[0]!.preload).toBe(false);
  });

  test('latin unicode-range and wildcard ranges mark preload', () => {
    const font = fakeFont(9000, 10);
    const css = `@font-face { font-family: Demo; src: url("${dataUri('font/woff2', font)}") format("woff2"); unicode-range: U+00??, U+0131; }`;
    const { assets } = extractFontAssets(css, OPTS);
    expect(assets[0]!.preload).toBe(true);
  });

  test('recovers original file names via nameForHash', () => {
    const font = fakeFont(9000, 11);
    const css = `@font-face { font-family: Demo; src: url("${dataUri('font/woff2', font)}") format("woff2"); }`;
    const { assets } = extractFontAssets(css, {
      ...OPTS,
      nameForHash: (hash) => (hash === fontContentHash(font) ? 'inter-latin-400-normal' : undefined),
    });
    expect(assets[0]!.fileName).toBe(`inter-latin-400-normal-${fontContentHash(font)}.woff2`);
  });

  test('identical bytes across faces dedupe into one asset', () => {
    const font = fakeFont(9000, 12);
    const face = `@font-face { font-family: Demo; src: url("${dataUri('font/woff2', font)}") format("woff2"); }`;
    const { assets } = extractFontAssets(`${face}\n${face}`, OPTS);
    expect(assets).toHaveLength(1);
  });

  test('leaves local() sources, external urls, and non-font data URIs untouched', () => {
    const css = [
      `@font-face { font-family: A; src: local("Arial"), url(https://example.com/a.woff2) format("woff2"); }`,
      `.bg { background: url("${dataUri('image/png', fakeFont(9000, 13))}"); }`,
    ].join('\n');
    const { css: out, assets } = extractFontAssets(css, OPTS);
    expect(assets).toHaveLength(0);
    expect(out).toContain('local("Arial")');
    expect(out).toContain('https://example.com/a.woff2');
    expect(out).toContain('data:image/png');
  });
});

describe('scanFontSourceNames', () => {
  test('maps content hashes to basenames across relative @import chains', () => {
    const dir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-font-scan-test-'));
    try {
      mkdirSync(path.join(dir, 'files'));
      const font = fakeFont(9000, 14);
      writeFileSync(path.join(dir, 'files', 'demo-latin-400-normal.woff2'), font);
      writeFileSync(path.join(dir, 'inner.css'), `@font-face { src: url(./files/demo-latin-400-normal.woff2) format('woff2'); }`);
      writeFileSync(path.join(dir, 'index.css'), `@import './inner.css';`);

      const names = scanFontSourceNames(path.join(dir, 'index.css'));
      expect(names.get(fontContentHash(font))).toBe('demo-latin-400-normal');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
