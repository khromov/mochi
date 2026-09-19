import { describe, expect, test } from 'bun:test';
import {
  fontSubsetFingerprint,
  formatRanges,
  intersectRanges,
  mergeFontSubsetSpecs,
  normalizeRanges,
  parseFontSubsetSpec,
  rangesToText,
  scanImportAttributes,
} from './fontImportAttributes';

describe('scanImportAttributes', () => {
  test('reads attributes off instance and module script imports in a .svelte file', () => {
    const source =
      `<script module>\n  import './shared.css' with { subset: 'abc' };\n<` +
      `/script>\n<script lang="ts">\n  import '@fontsource-variable/caveat' with { subset: "It's animated!", weight: '500' };\n  import Other from './Other.svelte';\n  let n: number = 1;\n<` +
      `/script>\n<p>{n}</p>\n`;
    expect(scanImportAttributes(source, 'svelte')).toEqual([
      { specifier: './shared.css', attributes: { subset: 'abc' }, line: 2 },
      { specifier: '@fontsource-variable/caveat', attributes: { subset: "It's animated!", weight: '500' }, line: 5 },
    ]);
  });

  test('skips files without a with-clause without parsing them', () => {
    expect(scanImportAttributes(`<script>\n  import './x.css';\n<` + `/script>\n<p>with {</p>`, 'svelte')).toEqual([]);
    expect(scanImportAttributes(`import './x.css';\nconst s = 'with { subset';`, 'script')).toEqual([]);
  });

  test('a .svelte file that fails to parse yields nothing rather than throwing', () => {
    expect(scanImportAttributes(`<script>\n  import './x.css' with { subset: 'a' };\n  const = ;\n<` + `/script>`, 'svelte')).toEqual([]);
  });

  test('scans script sources lexically, skipping strings and comments', () => {
    const source = [
      `// import './no.css' with { subset: 'commented' };`,
      `/* import './no.css' with { subset: 'block' } */`,
      `const s = "import './no.css' with { subset: 'string' }";`,
      `const t = \`multi`,
      `line import './no.css' with { subset: 'template' }\`;`,
      `import "./yes.css" with { subset: 'It\\'s', "weight": "700" };`,
      `import '@fontsource-variable/caveat'with{subset:"x",layoutClosure:'none'}`,
      `export const done = true;`,
    ].join('\n');
    expect(scanImportAttributes(source, 'script')).toEqual([
      { specifier: './yes.css', attributes: { subset: "It's", weight: '700' }, line: 6 },
      { specifier: '@fontsource-variable/caveat', attributes: { subset: 'x', layoutClosure: 'none' }, line: 7 },
    ]);
  });

  test('a regex literal holding a quote or backtick before an attributed import does not desync the scan', () => {
    const IMPORT = `import './x.css' with { subset: 'ok' };`;
    for (const regex of [`/'/`, `/"/`, '/`/', `/[/'"\`]+/g`, `/\\/'/`]) {
      // Same line, next line, and every position a regex can take: after `=`, `(`, `[`, `return`, and as a statement.
      expect(scanImportAttributes(`const re = ${regex}; ${IMPORT}`, 'script')).toEqual([{ specifier: './x.css', attributes: { subset: 'ok' }, line: 1 }]);
      expect(scanImportAttributes(`const re = ${regex};\n${IMPORT}`, 'script')).toEqual([{ specifier: './x.css', attributes: { subset: 'ok' }, line: 2 }]);
      const contexts = [`const a = ${regex}.test(s) ? f(${regex}, [${regex}]) : null;`, `if (x) return ${regex};`, `${regex}.lastIndex = 0;`, IMPORT].join('\n');
      expect(scanImportAttributes(contexts, 'script')).toEqual([{ specifier: './x.css', attributes: { subset: 'ok' }, line: 4 }]);
    }
  });

  test('division is not mistaken for a regex, so the import after it is still found', () => {
    const source = [
      `const half = total / 2;`,
      `const ratio = (a) / b / c.length / 'x'.length;`,
      `const perLine = list[0] / lines / (1 + n);`,
      `import './x.css' with { subset: 'ok' };`,
    ].join('\n');
    expect(scanImportAttributes(source, 'script')).toEqual([{ specifier: './x.css', attributes: { subset: 'ok' }, line: 4 }]);
  });

  test('decodes escapes in attribute values', () => {
    const source = `import './x.css' with { subset: "\\u00e9\\u{1F600}\\n\\t\\"" };`;
    expect(scanImportAttributes(source, 'script')[0]!.attributes.subset).toBe('é😀\n\t"');
  });

  test('a with-clause that is not literal key/value pairs is left alone', () => {
    expect(scanImportAttributes(`const w = '500';\nimport './x.css' with { weight: w };`, 'script')).toEqual([]);
  });
});

describe('parseFontSubsetSpec', () => {
  test('text, ranges, weight, axes and closure', () => {
    expect(parseFontSubsetSpec({ subset: 'Hi', unicodeRange: 'U+0020-007E, U+00A0', weight: '500', axes: 'wdth=87.5, slnt=-10', layoutClosure: 'none' })).toEqual({
      spec: {
        text: 'Hi',
        unicodeRanges: [
          { lo: 0x20, hi: 0x7e },
          { lo: 0xa0, hi: 0xa0 },
        ],
        axes: { wght: 500, wdth: 87.5, slnt: -10 },
        layoutClosure: false,
      },
      error: null,
    });
  });

  test('an import with no font keys is not a request', () => {
    expect(parseFontSubsetSpec({ type: 'css' })).toEqual({ spec: null, error: null });
    expect(parseFontSubsetSpec({})).toEqual({ spec: null, error: null });
  });

  test('rejects typos and unusable values instead of ignoring them', () => {
    expect(parseFontSubsetSpec({ subset: 'a', wieght: '500' }).error).toContain('unknown import attribute "wieght"');
    expect(parseFontSubsetSpec({ weight: '500' }).error).toContain('nothing to keep');
    expect(parseFontSubsetSpec({ subset: 'a', weight: 'bold' }).error).toContain('weight "bold"');
    expect(parseFontSubsetSpec({ subset: 'a', unicodeRange: '0020-007E' }).error).toContain('unicodeRange entry "0020-007E"');
    expect(parseFontSubsetSpec({ subset: 'a', axes: 'wdth' }).error).toContain('axes entry "wdth"');
    expect(parseFontSubsetSpec({ subset: 'a', layoutClosure: 'off' }).error).toContain('layoutClosure "off"');
  });
});

describe('range helpers', () => {
  test('normalizeRanges merges text and ranges into sorted, disjoint runs', () => {
    expect(
      normalizeRanges('cab', [
        { lo: 0x64, hi: 0x66 },
        { lo: 0x61, hi: 0x61 },
      ]),
    ).toEqual([{ lo: 0x61, hi: 0x66 }]);
    expect(normalizeRanges('😀a', [])).toEqual([
      { lo: 0x61, hi: 0x61 },
      { lo: 0x1f600, hi: 0x1f600 },
    ]);
  });

  test('intersectRanges keeps only the overlap', () => {
    expect(
      intersectRanges(
        [
          { lo: 0x20, hi: 0x7e },
          { lo: 0x400, hi: 0x4ff },
        ],
        [{ lo: 0x0, hi: 0xff }],
      ),
    ).toEqual([{ lo: 0x20, hi: 0x7e }]);
    expect(intersectRanges([{ lo: 0x20, hi: 0x7e }], [{ lo: 0x400, hi: 0x4ff }])).toEqual([]);
  });

  test('rangesToText expands ranges and formatRanges prints CSS syntax', () => {
    expect(
      rangesToText([
        { lo: 0x61, hi: 0x63 },
        { lo: 0x1f600, hi: 0x1f600 },
      ]),
    ).toBe('abc😀');
    expect(
      formatRanges([
        { lo: 0x61, hi: 0x63 },
        { lo: 0x1f600, hi: 0x1f600 },
      ]),
    ).toBe('U+0061-0063, U+1F600');
  });
});

describe('mergeFontSubsetSpecs', () => {
  const a = { text: 'abc', unicodeRanges: [], axes: { wght: 500 }, layoutClosure: true };
  const b = { text: 'xyz', unicodeRanges: [{ lo: 0x30, hi: 0x39 }], axes: { wght: 500 }, layoutClosure: true };
  const c = { text: 'abc', unicodeRanges: [], axes: { wght: 700 }, layoutClosure: true };

  test('sites agreeing on axes and closure share one group with the union of their glyphs', () => {
    expect(mergeFontSubsetSpecs([a, b])).toEqual([
      {
        axes: { wght: 500 },
        layoutClosure: true,
        ranges: [
          { lo: 0x30, hi: 0x39 },
          { lo: 0x61, hi: 0x63 },
          { lo: 0x78, hi: 0x7a },
        ],
      },
    ]);
  });

  test('a different pin becomes its own group, in a stable order', () => {
    const groups = mergeFontSubsetSpecs([c, a]);
    expect(groups.map((g) => g.axes.wght)).toEqual([500, 700]);
    expect(fontSubsetFingerprint(groups)).toBe(fontSubsetFingerprint(mergeFontSubsetSpecs([a, c])));
    expect(fontSubsetFingerprint(groups)).not.toBe(fontSubsetFingerprint(mergeFontSubsetSpecs([a])));
  });

  test('no specs fingerprint the same as no request', () => {
    expect(fontSubsetFingerprint(mergeFontSubsetSpecs([]))).toBe(fontSubsetFingerprint([]));
  });
});
