import { describe, expect, test } from 'bun:test';
import { classifyFontAssets, fontAssetFileName, fontContentHash, substituteFontUrl, type FontRef } from './cssFontAssets';

let refCounter = 0;
function makeRef(path: string, size = 10_000): FontRef {
  return { path, size, markerB64: Buffer.from(`__MOCHI_FONT_${refCounter++}__`).toString('base64') };
}

function markerUri(ref: FontRef, mime: string): string {
  return `data:${mime};base64,${ref.markerB64}`;
}

const DROP = { dropLegacyWoff: true };

describe('classifyFontAssets', () => {
  test('surfaces a marked woff2 with its bundler-stamped content type and marker URI', () => {
    const ref = makeRef('/pkg/files/inter-latin-400-normal.woff2');
    const css = `@font-face {\n  font-family: Demo;\n  src: url("${markerUri(ref, 'font/woff2')}") format("woff2");\n}`;
    const { css: out, fonts } = classifyFontAssets(css, [ref], DROP);

    expect(fonts).toHaveLength(1);
    expect(fonts[0]!.ref).toBe(ref);
    expect(fonts[0]!.contentType).toBe('font/woff2');
    expect(fonts[0]!.markerUri).toBe(markerUri(ref, 'font/woff2'));
    expect(fonts[0]!.preload).toBe(true);
    expect(out).toContain(`url("${markerUri(ref, 'font/woff2')}")`);
  });

  test('drops legacy woff sources when the face also offers woff2', () => {
    const woff2 = makeRef('/pkg/files/demo.woff2');
    const woff = makeRef('/pkg/files/demo.woff');
    const css = `@font-face {\n  font-family: Demo;\n  src: url("${markerUri(woff2, 'font/woff2')}") format("woff2"), url("${markerUri(woff, 'font/woff')}") format("woff");\n}`;
    const { css: out, fonts } = classifyFontAssets(css, [woff2, woff], DROP);

    expect(fonts.map((f) => f.ref)).toEqual([woff2]);
    expect(out).not.toContain(woff.markerB64);
    expect(out).not.toContain('format("woff")');
  });

  test('classifies formats from the resolved path when format() hints are absent', () => {
    const woff2 = makeRef('/pkg/files/demo.woff2');
    const woff = makeRef('/pkg/files/demo.woff');
    const css = `@font-face { font-family: Demo; src: url("${markerUri(woff2, 'font/woff2')}"), url("${markerUri(woff, 'font/woff')}"); }`;
    const { fonts } = classifyFontAssets(css, [woff2, woff], DROP);
    expect(fonts.map((f) => f.ref)).toEqual([woff2]);
  });

  test('keeps woff when it is the only offered format', () => {
    const woff = makeRef('/pkg/files/old.woff');
    const css = `@font-face { font-family: Old; src: url("${markerUri(woff, 'font/woff')}") format("woff"); }`;
    const { fonts } = classifyFontAssets(css, [woff], DROP);
    expect(fonts).toHaveLength(1);
    expect(fonts[0]!.preload).toBe(false);
  });

  test('dropLegacyWoff: false keeps both formats', () => {
    const woff2 = makeRef('/pkg/files/demo.woff2');
    const woff = makeRef('/pkg/files/demo.woff');
    const css = `@font-face { font-family: Demo; src: url("${markerUri(woff2, 'font/woff2')}") format("woff2"), url("${markerUri(woff, 'font/woff')}") format("woff"); }`;
    const { fonts } = classifyFontAssets(css, [woff2, woff], { dropLegacyWoff: false });
    expect(fonts.map((f) => f.ref)).toEqual([woff2, woff]);
  });

  test('drops a small inlined legacy woff alongside a marked woff2', () => {
    const woff2 = makeRef('/pkg/files/demo.woff2');
    const inlineWoffB64 = Buffer.from('tiny legacy woff bytes').toString('base64');
    const css = `@font-face { font-family: Demo; src: url("${markerUri(woff2, 'font/woff2')}") format("woff2"), url("data:font/woff;base64,${inlineWoffB64}") format("woff"); }`;
    const { css: out, fonts } = classifyFontAssets(css, [woff2], DROP);
    expect(fonts.map((f) => f.ref)).toEqual([woff2]);
    expect(out).not.toContain(inlineWoffB64);
  });

  test('variable fonts (format woff2-variations) still preload', () => {
    const ref = makeRef('/pkg/files/fraunces-latin-full-normal.woff2');
    const css = `@font-face { font-family: Fraunces; src: url("${markerUri(ref, 'font/woff2')}") format("woff2-variations"); unicode-range: U+0000-00FF; }`;
    const { fonts } = classifyFontAssets(css, [ref], DROP);
    expect(fonts[0]!.preload).toBe(true);
  });

  test('non-latin unicode-range faces survive but are not preloaded', () => {
    const ref = makeRef('/pkg/files/cyrillic.woff2');
    const css = `@font-face {\n  font-family: Demo;\n  src: url("${markerUri(ref, 'font/woff2')}") format("woff2");\n  unicode-range: U+0400-045F, U+0490-0491;\n}`;
    const { fonts } = classifyFontAssets(css, [ref], DROP);
    expect(fonts).toHaveLength(1);
    expect(fonts[0]!.preload).toBe(false);
  });

  test('latin wildcard unicode-range marks preload', () => {
    const ref = makeRef('/pkg/files/latin.woff2');
    const css = `@font-face { font-family: Demo; src: url("${markerUri(ref, 'font/woff2')}") format("woff2"); unicode-range: U+00??, U+0131; }`;
    const { fonts } = classifyFontAssets(css, [ref], DROP);
    expect(fonts[0]!.preload).toBe(true);
  });

  test('a ref used by two faces is reported once, preloaded if any face qualifies', () => {
    const ref = makeRef('/pkg/files/shared.woff2');
    const face = (range: string) => `@font-face { font-family: Demo; src: url("${markerUri(ref, 'font/woff2')}") format("woff2"); unicode-range: ${range}; }`;
    const { fonts } = classifyFontAssets(`${face('U+0400-045F')}\n${face('U+0000-00FF')}`, [ref], DROP);
    expect(fonts).toHaveLength(1);
    expect(fonts[0]!.preload).toBe(true);
  });

  test('a ref referenced outside any @font-face block still survives, without preload', () => {
    const ref = makeRef('/pkg/files/decorative.woff2');
    const css = `.weird { cursor: url("${markerUri(ref, 'font/woff2')}"), auto; }`;
    const { fonts } = classifyFontAssets(css, [ref], DROP);
    expect(fonts).toHaveLength(1);
    expect(fonts[0]!.preload).toBe(false);
  });

  test('leaves small inlined fonts, local() sources, and external urls untouched', () => {
    const realB64 = Buffer.from('actual small font bytes').toString('base64');
    const css = `@font-face { font-family: A; src: local("Arial"), url("data:font/woff2;base64,${realB64}") format("woff2"), url(https://example.com/a.woff2) format("woff2"); }`;
    const { css: out, fonts } = classifyFontAssets(css, [makeRef('/unrelated.woff2')], DROP);
    expect(fonts).toHaveLength(0);
    expect(out).toBe(css);
  });

  test('no refs is a no-op', () => {
    const css = `@font-face { font-family: A; src: url(x.woff) format("woff"); }`;
    expect(classifyFontAssets(css, [], DROP)).toEqual({ css, fonts: [] });
  });

  test('drops an inlined legacy woff even when no ref exceeded the threshold', () => {
    const woff2B64 = Buffer.from('small woff2 bytes').toString('base64');
    const woffB64 = Buffer.from('small legacy woff bytes').toString('base64');
    const css = `@font-face { font-family: Demo; src: url("data:font/woff2;base64,${woff2B64}") format("woff2"), url("data:font/woff;base64,${woffB64}") format("woff"); }`;
    const { css: out, fonts } = classifyFontAssets(css, [], DROP);
    expect(fonts).toHaveLength(0);
    expect(out).toContain(woff2B64);
    expect(out).not.toContain(woffB64);
  });

  test('a dropped source with multi-argument tech() takes its whole tail with it', () => {
    const woff2 = makeRef('/pkg/files/demo.woff2');
    const woff = makeRef('/pkg/files/demo.woff');
    const css = `@font-face { font-family: Demo; src: url("${markerUri(woff2, 'font/woff2')}") format("woff2"), url("${markerUri(woff, 'font/woff')}") format("woff") tech(features-aat, color-COLRv1); }`;
    const { css: out, fonts } = classifyFontAssets(css, [woff2, woff], DROP);
    expect(fonts.map((f) => f.ref)).toEqual([woff2]);
    expect(out).not.toContain(woff.markerB64);
    expect(out).not.toContain('color-COLRv1');
  });

  test('multi-argument tech() on a kept source survives intact', () => {
    const woff2 = makeRef('/pkg/files/demo.woff2');
    const css = `@font-face { font-family: Demo; src: url("${markerUri(woff2, 'font/woff2')}") format("woff2") tech(features-aat, color-COLRv1); }`;
    const { css: out, fonts } = classifyFontAssets(css, [woff2], DROP);
    expect(fonts).toHaveLength(1);
    expect(out).toContain('tech(features-aat, color-COLRv1)');
  });
});

describe('substituteFontUrl', () => {
  const MARKER = `data:font/woff2;base64,${Buffer.from('__MOCHI_FONT_0__').toString('base64')}`;
  const URL = '/_mochi/fonts/demo-1a2b3c4d.woff2';

  test('substitutes double-quoted, single-quoted, and unquoted url() forms', () => {
    for (const token of [`url("${MARKER}")`, `url('${MARKER}')`, `url(${MARKER})`]) {
      expect(substituteFontUrl(`src: ${token} format("woff2");`, MARKER, URL)).toBe(`src: url(${URL}) format("woff2");`);
    }
  });

  test('leaves other urls and mismatched quoting alone', () => {
    const css = `src: url("data:font/woff2;base64,c29tZXRoaW5nZWxzZQ==") format("woff2");`;
    expect(substituteFontUrl(css, MARKER, URL)).toBe(css);
  });
});

describe('fontAssetFileName', () => {
  test('derives basename-hash.ext from the resolved path and bytes', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const ref = makeRef('/pkg/files/inter-latin-400-normal.woff2');
    expect(fontAssetFileName(ref, bytes)).toBe(`inter-latin-400-normal-${fontContentHash(bytes)}.woff2`);
  });

  test('sanitizes unusual basename characters', () => {
    const bytes = new Uint8Array([4, 5, 6]);
    const ref = makeRef('/pkg/files/we ird@font.woff');
    expect(fontAssetFileName(ref, bytes)).toBe(`we-ird-font-${fontContentHash(bytes)}.woff`);
  });
});
