import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { applyFontSubsets, loadFontSubsetter } from './fontSubset';
import { mergeFontSubsetSpecs, normalizeRanges } from './fontImportAttributes';
import { parseCss, type FontFace } from './cssAst';
import type { FontRef, SurvivingFont } from './cssFontAssets';

const FIXTURE = path.join(import.meta.dir, '..', '__fixtures__', 'fonts', 'caveat-latin-wght-normal.woff2');
const MARKER_B64 = Buffer.from('__MOCHI_FONT_0__').toString('base64');
const MARKER_URI = `data:font/woff2;base64,${MARKER_B64}`;

function fixtureFont(): { ref: FontRef; font: SurvivingFont } {
  const ref: FontRef = { path: FIXTURE, size: 74932, markerB64: MARKER_B64 };
  return { ref, font: { ref, contentType: 'font/woff2', markerUri: MARKER_URI, preload: true } };
}

const CAVEAT_CSS = `@font-face{font-family:Caveat Variable;font-style:normal;font-display:swap;font-weight:400 700;src:url(${MARKER_URI})format("woff2-variations");unicode-range:U+0000-00FF,U+0131,U+0152-0153}`;

function faces(css: string): FontFace[] {
  const document = parseCss(css);
  expect(document).not.toBeNull();
  return document!.fontFaces;
}

async function run(css: string, specs: Parameters<typeof mergeFontSubsetSpecs>[0], inlineThreshold = 4096, cacheDir?: string) {
  const { font } = fixtureFont();
  const emitted: number[] = [];
  const result = await applyFontSubsets(css, [font], mergeFontSubsetSpecs(specs), {
    inlineThreshold,
    cacheDir,
    subset: await loadFontSubsetter(),
    readSource: () => Bun.file(FIXTURE).bytes(),
    emit: async (_ref, bytes) => {
      emitted.push(bytes.length);
      return `/_mochi/fonts/subset-${emitted.length}.woff2`;
    },
  });
  return { ...result, emitted };
}

describe('applyFontSubsets', () => {
  const text = "It's animated!";

  test('the motivating case: text-only, pinned, and without layout closure land at the measured sizes', async () => {
    const plain = await run(CAVEAT_CSS, [{ text, unicodeRanges: [], axes: {}, layoutClosure: true }]);
    const pinned = await run(CAVEAT_CSS, [{ text, unicodeRanges: [], axes: { wght: 500 }, layoutClosure: true }]);
    const noClosure = await run(CAVEAT_CSS, [{ text, unicodeRanges: [], axes: { wght: 500 }, layoutClosure: false }]);
    expect(plain.emitted).toEqual([8160]);
    expect(pinned.emitted).toEqual([5388]);
    // Under the 4 kB threshold: inlined as a data: URI, so nothing is emitted and nothing preloads.
    expect(noClosure.emitted).toEqual([]);
    expect(noClosure.variants[0]!.bytes.length).toBe(2464);
    expect(noClosure.variants[0]!.inlined).toBe(true);
    expect(noClosure.variants[0]!.preload).toBe(false);
    const [source] = faces(noClosure.css)[0]!.sources;
    expect(source!.url!.value.startsWith('data:font/woff2;base64,')).toBe(true);
    expect(source!.format).toBe('woff2');
    expect(noClosure.css).not.toContain(MARKER_B64);
  });

  test('an emitted subset points the face at the served URL, keeps preload, and stays variable when unpinned', async () => {
    const plain = await run(CAVEAT_CSS, [{ text, unicodeRanges: [], axes: {}, layoutClosure: true }]);
    const [source] = faces(plain.css)[0]!.sources;
    expect(source!.url!.value).toBe('/_mochi/fonts/subset-1.woff2');
    expect(source!.format).toBe('woff2-variations');
    expect(plain.css).toContain('font-weight:400 700');
    expect(plain.variants[0]).toMatchObject({ inlined: false, preload: true, url: '/_mochi/fonts/subset-1.woff2', family: 'Caveat Variable' });
    expect(plain.variants[0]!.ranges).toEqual(normalizeRanges(text, []));
  });

  test('pinning wght rewrites the font-weight descriptor and drops the -variations format hint', async () => {
    const pinned = await run(CAVEAT_CSS, [{ text, unicodeRanges: [], axes: { wght: 500 }, layoutClosure: true }]);
    expect(pinned.css).toContain('font-weight:500;');
    expect(faces(pinned.css)[0]!.sources[0]!.format).toBe('woff2');
    expect(pinned.css).not.toContain('400 700');
  });

  test('a face without a font-weight descriptor gains one when pinned', async () => {
    const css = `@font-face{font-family:Caveat Variable;src:url(${MARKER_URI})format(woff2-variations)}`;
    const pinned = await run(css, [{ text, unicodeRanges: [], axes: { wght: 600 }, layoutClosure: true }]);
    expect(pinned.css).toContain('font-weight:600;}');
    expect(faces(pinned.css)[0]!.sources[0]!.format).toBe('woff2');
  });

  test('two pins produce two faces the browser can pick between by weight', async () => {
    const both = await run(CAVEAT_CSS, [
      { text, unicodeRanges: [], axes: { wght: 500 }, layoutClosure: true },
      { text, unicodeRanges: [], axes: { wght: 700 }, layoutClosure: true },
    ]);
    expect(faces(both.css)).toHaveLength(2);
    expect(both.css).toContain('font-weight:500;');
    expect(both.css).toContain('font-weight:700;');
    expect(both.emitted).toHaveLength(2);
  });

  test('a face whose unicode-range misses the request is dropped, and one that overlaps keeps only the overlap', async () => {
    const cyrillic = `@font-face{font-family:Caveat Variable;font-weight:400 700;src:url(${MARKER_URI})format("woff2-variations");unicode-range:U+0400-045F}`;
    const dropped = await run(`${cyrillic}\n${CAVEAT_CSS}`, [{ text, unicodeRanges: [], axes: {}, layoutClosure: true }]);
    expect(dropped.droppedFaces).toBe(1);
    expect(faces(dropped.css)).toHaveLength(1);
    expect(dropped.css).not.toContain('U+0400-045F');

    const wide = await run(CAVEAT_CSS, [{ text: '', unicodeRanges: [{ lo: 0x20, hi: 0x4ff }], axes: {}, layoutClosure: true }]);
    expect(wide.variants[0]!.ranges).toEqual([
      { lo: 0x20, hi: 0xff },
      { lo: 0x131, hi: 0x131 },
      { lo: 0x152, hi: 0x153 },
    ]);
  });

  test('sources HarfBuzz cannot write keep their marker for the regular extraction', async () => {
    const ref: FontRef = { path: '/fonts/legacy.eot', size: 100, markerB64: MARKER_B64 };
    const font: SurvivingFont = { ref, contentType: 'application/vnd.ms-fontobject', markerUri: MARKER_URI, preload: false };
    const css = `@font-face{font-family:Legacy;src:url(${MARKER_URI})format("embedded-opentype")}`;
    const result = await applyFontSubsets(css, [font], mergeFontSubsetSpecs([{ text, unicodeRanges: [], axes: {}, layoutClosure: true }]), {
      inlineThreshold: 4096,
      subset: await loadFontSubsetter(),
      readSource: () => Promise.reject(new Error('should not read')),
      emit: () => Promise.reject(new Error('should not emit')),
    });
    expect(result.css).toBe(css);
    expect(result.variants).toEqual([]);
  });

  test('the cache directory serves a repeat request without re-subsetting', async () => {
    const cacheDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-font-subset-cache-'));
    try {
      const first = await run(CAVEAT_CSS, [{ text, unicodeRanges: [], axes: { wght: 500 }, layoutClosure: true }], 4096, cacheDir);
      expect(readdirSync(cacheDir)).toHaveLength(1);
      const { font } = fixtureFont();
      const second = await applyFontSubsets(CAVEAT_CSS, [font], mergeFontSubsetSpecs([{ text, unicodeRanges: [], axes: { wght: 500 }, layoutClosure: true }]), {
        inlineThreshold: 4096,
        cacheDir,
        subset: () => Promise.reject(new Error('cache miss')),
        readSource: () => Bun.file(FIXTURE).bytes(),
        emit: async () => '/_mochi/fonts/cached.woff2',
      });
      expect(second.variants[0]!.bytes).toEqual(first.variants[0]!.bytes);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});
