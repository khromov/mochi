import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { adoptEmittedFontAssets, classifyFontAssets, fontAssetFileName, fontContentHash, stripFontFaces, substituteFontUrl, type FontRef } from './cssFontAssets';

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

  test('keeps the local woff fallback when the only woff2 is an external URL', () => {
    const woff = makeRef('/pkg/files/demo.woff');
    const css = `@font-face { font-family: Demo; src: url(https://cdn.example.com/demo.woff2) format("woff2"), url("${markerUri(woff, 'font/woff')}") format("woff"); }`;
    const { css: out, fonts } = classifyFontAssets(css, [woff], DROP);
    expect(fonts.map((f) => f.ref)).toEqual([woff]);
    expect(out).toContain('https://cdn.example.com/demo.woff2');
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

describe('adoptEmittedFontAssets', () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  function emit(name: string, contents: Uint8Array | string): string {
    tmp ??= mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-adopt-test-'));
    const file = path.join(tmp, name);
    writeFileSync(file, contents);
    return file;
  }

  test('reuses the existing ref when the emitted file holds a marker', async () => {
    const ref = makeRef('/pkg/files/demo-latin-400-normal.woff2');
    const marker = Buffer.from(ref.markerB64, 'base64').toString();
    const file = emit('demo-latin-400-normal-abcd1234.woff2', marker);
    const css = `@font-face { src: url("./${path.basename(file)}") format("woff2"); }`;
    const refs = [ref];

    const { css: out, otherAssets } = await adoptEmittedFontAssets(css, [{ path: file }], refs);

    expect(refs).toEqual([ref]);
    expect(otherAssets).toEqual([]);
    expect(out).toContain(`url(data:font/woff2;base64,${ref.markerB64})`);
    expect(existsSync(file)).toBe(false);
  });

  test('adopts a font Bun copied itself, carrying its bytes and un-hashed name', async () => {
    const bytes = new Uint8Array([9, 8, 7, 6]);
    const file = emit('fraunces-latin-full-italic-7eta9vw9.woff2', bytes);
    const css = `@font-face { src: url("./${path.basename(file)}") format("woff2"); }`;
    const refs: FontRef[] = [];

    const { css: out, otherAssets } = await adoptEmittedFontAssets(css, [{ path: file }], refs);

    expect(otherAssets).toEqual([]);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.bytes).toEqual(bytes);
    expect(path.basename(refs[0]!.path)).toBe('fraunces-latin-full-italic.woff2');
    expect(out).toContain(`url(data:font/woff2;base64,${refs[0]!.markerB64})`);
    expect(fontAssetFileName(refs[0]!, bytes)).toBe(`fraunces-latin-full-italic-${fontContentHash(bytes)}.woff2`);
    expect(existsSync(file)).toBe(false);
  });

  test('substitutes unquoted and bare-name url() forms', async () => {
    const bytes = new Uint8Array([1, 2]);
    const file = emit('demo-1a2b3c4d.woff', bytes);
    const refs: FontRef[] = [];
    const { css: out } = await adoptEmittedFontAssets(`a { src: url(${path.basename(file)}); }`, [{ path: file }], refs);
    expect(out).toBe(`a { src: url(data:font/woff;base64,${refs[0]!.markerB64}); }`);
  });

  test('leaves a font whose url() it cannot match in place, holding the real bytes', async () => {
    const ref = makeRef('/pkg/files/source.woff2');
    const marker = Buffer.from(ref.markerB64, 'base64').toString();
    const file = emit('source-abcd1234.woff2', marker);
    const source = emit('source.woff2', new Uint8Array([5, 5, 5]));
    ref.path = source;
    const css = '@font-face { src: url("/somewhere/else.woff2") format("woff2"); }';
    const refs = [ref];

    const { css: out, otherAssets } = await adoptEmittedFontAssets(css, [{ path: file }], refs);

    expect(out).toBe(css);
    expect(otherAssets).toEqual([file]);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file)).toEqual(readFileSync(source));
  });

  test('leaves a non-font artifact alone for the caller to serve', async () => {
    const file = emit('hero-1a2b3c4d.png', new Uint8Array([1, 2, 3]));
    const css = `a { background: url("./${path.basename(file)}"); }`;
    const refs: FontRef[] = [];

    const { css: out, otherAssets } = await adoptEmittedFontAssets(css, [{ path: file }], refs);

    expect(otherAssets).toEqual([file]);
    expect(refs).toEqual([]);
    expect(out).toBe(css);
    expect(existsSync(file)).toBe(true);
  });
});

describe('stripFontFaces', () => {
  test('removes every face and counts them, leaving other rules alone', () => {
    const css = `@font-face { font-family: A; src: url(data:font/woff2;base64,AA==); }\nbody { color: red; }\n@font-face { font-family: B; src: url(/_mochi/fonts/b-1a2b3c4d.woff2); }`;
    const { css: out, dropped } = stripFontFaces(css);

    expect(dropped).toBe(2);
    expect(out).not.toContain('@font-face');
    expect(out).not.toContain('base64');
    expect(out).toContain('body { color: red; }');
  });

  test('is a no-op without faces', () => {
    const css = 'body { color: red; }';
    expect(stripFontFaces(css)).toEqual({ css, dropped: 0 });
  });
});
