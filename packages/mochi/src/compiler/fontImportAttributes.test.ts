import { describe, expect, test } from 'bun:test';
import {
  formatRanges,
  intersectRanges,
  mergeFontSubsetSpecs,
  mergeRanges,
  parseFontSubsetSpec,
  rangesByFamily,
  rangesToText,
  scanImportAttributes,
  scriptKindOf,
  textToRanges,
} from './fontImportAttributes';

const IMPORT = `import './x.css' with { subset: 'ok' };`;
const found = (line: number) => [{ specifier: './x.css', attributes: { subset: 'ok' }, line }];

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

  test('skips files that never mention `with` without parsing them', () => {
    expect(scanImportAttributes(`<script>\n  import './x.css';\n<` + `/script>\n<p>{</p>`, 'svelte')).toEqual([]);
    expect(scanImportAttributes(`import './x.css';\nconst s = 'subset';`, 'ts')).toEqual([]);
  });

  test('a file that fails to parse yields nothing rather than throwing', () => {
    expect(scanImportAttributes(`<script>\n  ${IMPORT}\n  const = ;\n<` + `/script>`, 'svelte')).toEqual([]);
    expect(scanImportAttributes(`${IMPORT}\nconst = ;`, 'ts')).toEqual([]);
  });

  test('imports inside strings, comments and templates are not imports', () => {
    const source = [
      `// ${IMPORT}`,
      `/* ${IMPORT} */`,
      `const s = "import './no.css' with { subset: 'string' }";`,
      `const t = \`multi`,
      `line ${IMPORT}\`;`,
      `import "./yes.css" with { subset: 'It\\'s', "weight": "700" };`,
      `import '@fontsource-variable/caveat'with{subset:"x",layoutClosure:'none'}`,
      `export const done = true;`,
    ].join('\n');
    expect(scanImportAttributes(source, 'ts')).toEqual([
      { specifier: './yes.css', attributes: { subset: "It's", weight: '700' }, line: 6 },
      { specifier: '@fontsource-variable/caveat', attributes: { subset: 'x', layoutClosure: 'none' }, line: 7 },
    ]);
  });

  test('a regex literal holding a quote or backtick before an attributed import does not confuse the parser', () => {
    for (const regex of [`/'/`, `/"/`, '/`/', `/[/'"\`]+/g`, `/\\/'/`]) {
      expect(scanImportAttributes(`const re = ${regex}; ${IMPORT}`, 'ts')).toEqual(found(1));
      expect(scanImportAttributes(`const re = ${regex};\n${IMPORT}`, 'js')).toEqual(found(2));
      const contexts = [`const a = ${regex}.test(s) ? f(${regex}, [${regex}]) : null;`, `function g() { return ${regex}; }`, `${regex}.lastIndex = 0;`, IMPORT].join('\n');
      expect(scanImportAttributes(contexts, 'ts')).toEqual(found(4));
    }
  });

  test('division is division', () => {
    const source = [`const half = total / 2;`, `const ratio = (a) / b / c.length / 'x'.length;`, `const perLine = list[0] / lines / (1 + n);`, IMPORT].join('\n');
    expect(scanImportAttributes(source, 'js')).toEqual(found(4));
  });

  test('TypeScript-only syntax parses under the ts kind, and JSX under tsx/jsx', () => {
    const ts = [
      `import type { A } from './a';`,
      `export type B = A;`,
      `enum E { X = 1 }`,
      `declare module 'foo' {}`,
      `const v = 1 satisfies number;`,
      `class C { #p = 1; @dec() m(): void {} }`,
      `export default function f<T>(x: T): T { return x; }`,
      `namespace NS { export const y = 1 }`,
      `await Promise.resolve();`,
      IMPORT,
    ].join('\n');
    expect(scanImportAttributes(ts, 'ts')).toEqual(found(10));
    expect(scanImportAttributes(`const el = <p className="x">It's "quoted"</p>;\n${IMPORT}`, 'tsx')).toEqual(found(2));
    expect(scanImportAttributes(`const el = <p>Don't</p>;\n${IMPORT}`, 'jsx')).toEqual(found(2));
  });

  test('string escapes arrive decoded', () => {
    const source = `import './x.css' with { subset: "\\u00e9\\u{1F600}\\n\\t\\"" };`;
    expect(scanImportAttributes(source, 'ts')[0]!.attributes.subset).toBe('é😀\n\t"');
  });

  test('scriptKindOf maps extensions and rejects non-scripts', () => {
    expect(['a.svelte', 'a.ts', 'a.mts', 'a.cts', 'a.tsx', 'a.js', 'a.mjs', 'a.cjs', 'a.jsx', 'a.svelte.ts', 'a.css', 'a.md', 'a.png'].map(scriptKindOf)).toEqual([
      'svelte',
      'ts',
      'ts',
      'ts',
      'tsx',
      'js',
      'js',
      'js',
      'jsx',
      'ts',
      null,
      null,
      null,
    ]);
  });
});

describe('parseFontSubsetSpec', () => {
  test('text, weight and closure', () => {
    expect(parseFontSubsetSpec({ subset: 'Hi', weight: '500', layoutClosure: 'none' })).toEqual({ spec: { text: 'Hi', weight: 500, layoutClosure: false }, error: null });
    expect(parseFontSubsetSpec({ type: 'css', subset: 'Hi' })).toEqual({ spec: { text: 'Hi', weight: null, layoutClosure: true }, error: null });
  });

  test('a stylesheet import with no font keys is not a request', () => {
    expect(parseFontSubsetSpec({ type: 'css' })).toEqual({ spec: null, error: null });
    expect(parseFontSubsetSpec({})).toEqual({ spec: null, error: null });
  });

  test('rejects typos and unusable values instead of ignoring them', () => {
    expect(parseFontSubsetSpec({ subset: 'a', wieght: '500' }).error).toContain('unknown import attribute "wieght"');
    expect(parseFontSubsetSpec({ subst: 'a' }).error).toContain('unknown import attribute "subst"');
    expect(parseFontSubsetSpec({ weight: '500' }).error).toContain('nothing to keep');
    expect(parseFontSubsetSpec({ subset: 'a', weight: 'bold' }).error).toContain('weight "bold"');
    expect(parseFontSubsetSpec({ subset: 'a', weight: '' }).error).toContain('weight ""');
    expect(parseFontSubsetSpec({ subset: 'a', layoutClosure: 'off' }).error).toContain('layoutClosure "off"');
  });
});

describe('range helpers', () => {
  test('textToRanges and mergeRanges produce sorted, disjoint runs', () => {
    expect(textToRanges('cabca')).toEqual([{ lo: 0x61, hi: 0x63 }]);
    expect(textToRanges('😀a')).toEqual([
      { lo: 0x61, hi: 0x61 },
      { lo: 0x1f600, hi: 0x1f600 },
    ]);
    expect(
      mergeRanges([
        { lo: 0x64, hi: 0x66 },
        { lo: 0x61, hi: 0x63 },
        { lo: 0x70, hi: 0x70 },
      ]),
    ).toEqual([
      { lo: 0x61, hi: 0x66 },
      { lo: 0x70, hi: 0x70 },
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

  test('rangesByFamily merges faces of one family under its lowercased name', () => {
    expect(
      rangesByFamily([
        { family: 'Caveat Variable', ranges: [{ lo: 0x61, hi: 0x63 }] },
        { family: 'caveat variable', ranges: [{ lo: 0x62, hi: 0x64 }] },
        { family: 'Other', ranges: [{ lo: 0x30, hi: 0x30 }] },
      ]),
    ).toEqual({ 'caveat variable': [[0x61, 0x64]], other: [[0x30, 0x30]] });
  });
});

describe('mergeFontSubsetSpecs', () => {
  const a = { text: 'abc', weight: 500, layoutClosure: true };
  const b = { text: 'xyz', weight: 500, layoutClosure: true };
  const c = { text: 'abc', weight: 700, layoutClosure: true };

  test('sites agreeing on weight share one group with the union of their glyphs', () => {
    expect(mergeFontSubsetSpecs([a, b])).toEqual([
      {
        weight: 500,
        layoutClosure: true,
        ranges: [
          { lo: 0x61, hi: 0x63 },
          { lo: 0x78, hi: 0x7a },
        ],
      },
    ]);
  });

  test('a different weight becomes its own group, the unpinned one first, whatever the order of the sites', () => {
    const unpinned = { text: 'abc', weight: null, layoutClosure: true };
    const groups = mergeFontSubsetSpecs([c, a, unpinned]);
    expect(groups.map((g) => g.weight)).toEqual([null, 500, 700]);
    expect(groups).toEqual(mergeFontSubsetSpecs([unpinned, a, c]));
  });

  test('a face drops layout closure only when every site sharing it asks to', () => {
    const none = { text: 'abc', weight: 500, layoutClosure: false };
    expect(mergeFontSubsetSpecs([none, { ...none, text: 'xyz' }])[0]!.layoutClosure).toBe(false);
    expect(mergeFontSubsetSpecs([none, b])).toHaveLength(1);
    expect(mergeFontSubsetSpecs([none, b])[0]!.layoutClosure).toBe(true);
    // A different weight is a face of its own, so its closure is its own too.
    expect(mergeFontSubsetSpecs([none, c]).map((g) => g.layoutClosure)).toEqual([false, true]);
  });
});
