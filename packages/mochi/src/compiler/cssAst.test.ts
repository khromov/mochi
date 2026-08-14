import { describe, expect, test } from 'bun:test';
import { parseCss, parseDataUri, parseUnicodeRange, removalSpans } from './cssAst';

function doc(css: string) {
  const parsed = parseCss(css);
  expect(parsed).not.toBeNull();
  return parsed!;
}

/** The text a span selects, so assertions read as the CSS they target rather than as offsets. */
function at(css: string, span: { start: number; end: number }): string {
  return css.slice(span.start, span.end);
}

describe('parseCss urls', () => {
  test('decodes every quoting form to the same value', () => {
    const css = `a { src: url("x.woff2"); } b { src: url('x.woff2'); } c { src: url(x.woff2); }`;
    expect(doc(css).urls.map((u) => u.value)).toEqual(['x.woff2', 'x.woff2', 'x.woff2']);
  });

  test('spans cover the whole url() token', () => {
    const css = `a { src: url( "x.woff2" ) }`;
    const [url] = doc(css).urls;
    expect(at(css, url!)).toBe('url( "x.woff2" )');
  });

  test('keeps a data URI intact despite its semicolons and commas', () => {
    const css = `a { src: url(data:font/woff2;base64,AAAA==) format("woff2"), url(b.woff) }`;
    expect(doc(css).urls.map((u) => u.value)).toEqual(['data:font/woff2;base64,AAAA==', 'b.woff']);
  });

  test('finds urls inside custom properties', () => {
    expect(doc(':root { --f: url(x.woff2); }').urls.map((u) => u.value)).toEqual(['x.woff2']);
  });

  test('decodes escapes and reports them in source order', () => {
    const css = String.raw`a { src: url("we\"ird.woff2"), url(sp\ ace.woff2); }`;
    expect(doc(css).urls.map((u) => u.value)).toEqual(['we"ird.woff2', 'sp ace.woff2']);
  });

  test('minified input parses', () => {
    expect(doc('@font-face{src:url(a.woff2)format("woff2")}').urls.map((u) => u.value)).toEqual(['a.woff2']);
  });

  test('unparseable input yields no urls rather than throwing', () => {
    expect(doc('}}} not css {{{ ;;; @@@').urls).toEqual([]);
    expect(doc('').urls).toEqual([]);
  });
});

describe('parseCss font faces', () => {
  test('span runs through the closing brace', () => {
    const css = `body { color: red }\n@font-face { font-family: A; src: url(a.woff2) }\n`;
    const [face] = doc(css).fontFaces;
    expect(at(css, face!)).toBe('@font-face { font-family: A; src: url(a.woff2) }');
  });

  test('a brace inside a string does not end the block', () => {
    const css = `@font-face { font-family: "we}ird"; src: url(a.woff2) }`;
    const [face] = doc(css).fontFaces;
    expect(at(css, face!)).toBe(css);
    expect(face!.sources).toHaveLength(1);
  });

  test('finds a face nested in @media', () => {
    const css = `@media screen { @font-face { src: url(a.woff2) } }`;
    expect(doc(css).fontFaces.map((f) => at(css, f))).toEqual(['@font-face { src: url(a.woff2) }']);
  });

  test('reads format() hints whether quoted or bare', () => {
    const css = `@font-face { src: url(a.woff2) format("WOFF2"), url(b.woff) format(woff), local("Arial"); }`;
    expect(doc(css).fontFaces[0]!.sources.map((s) => [s.url?.value ?? null, s.format])).toEqual([
      ['a.woff2', 'woff2'],
      ['b.woff', 'woff'],
      [null, null],
    ]);
  });

  test('a comma inside tech() does not split the source list', () => {
    const css = `@font-face { src: url(a.woff2) format("woff2") tech(features-aat, color-COLRv1), url(b.woff); }`;
    const { sources } = doc(css).fontFaces[0]!;
    expect(sources).toHaveLength(2);
    expect(at(css, sources[0]!)).toBe('url(a.woff2) format("woff2") tech(features-aat, color-COLRv1)');
  });

  test('src urls share identity with the document url list', () => {
    const parsed = doc('@font-face { src: url(a.woff2); }');
    expect(parsed.fontFaces[0]!.sources[0]!.url).toBe(parsed.urls[0]!);
  });

  test('!important stays outside the source spans', () => {
    const css = `@font-face { src: url(a.woff2) !important; }`;
    expect(at(css, doc(css).fontFaces[0]!.sources[0]!)).toBe('url(a.woff2)');
  });

  test('a face without src has no sources', () => {
    expect(doc('@font-face { font-family: A; }').fontFaces[0]!.sources).toEqual([]);
  });
});

describe('removalSpans', () => {
  const css = `@font-face { src: url(a.woff2) format("woff2"), url(b.woff) format(woff) tech(features-aat, color-COLRv1), local("Arial"); }`;

  function drop(source: string, ...indices: number[]): string {
    const sources = doc(source).fontFaces[0]!.sources;
    const spans = removalSpans(sources, new Set(indices)).sort((a, b) => b.start - a.start);
    return spans.reduce((text, span) => text.slice(0, span.start) + text.slice(span.end), source);
  }

  test('dropping a middle source takes the preceding comma and its whole tail', () => {
    expect(drop(css, 1)).toBe(`@font-face { src: url(a.woff2) format("woff2"), local("Arial"); }`);
  });

  test('dropping the last source takes the preceding comma', () => {
    expect(drop(css, 2)).toBe(`@font-face { src: url(a.woff2) format("woff2"), url(b.woff) format(woff) tech(features-aat, color-COLRv1); }`);
  });

  test('dropping the first source takes the following comma', () => {
    expect(drop(css, 0)).toBe(`@font-face { src:  url(b.woff) format(woff) tech(features-aat, color-COLRv1), local("Arial"); }`);
  });

  // Deleting each source's own span would take the comma between them twice and leave a dangling one.
  test('a run of consecutive drops takes exactly one comma', () => {
    const list = `@font-face { src: url(a.woff), url(b.woff), url(c.woff2), url(d.woff); }`;
    expect(drop(list, 0, 1)).toBe(`@font-face { src:  url(c.woff2), url(d.woff); }`);
    expect(drop(list, 1, 2)).toBe(`@font-face { src: url(a.woff), url(d.woff); }`);
    expect(drop(list, 2, 3)).toBe(`@font-face { src: url(a.woff), url(b.woff); }`);
    expect(drop(list, 0, 1, 3)).toBe(`@font-face { src:  url(c.woff2); }`);
  });

  test('non-adjacent drops each take their own comma', () => {
    expect(drop(css, 0, 2)).toBe(`@font-face { src:  url(b.woff) format(woff) tech(features-aat, color-COLRv1); }`);
  });

  test('dropping every source is refused, since an empty src: invalidates the face', () => {
    expect(removalSpans(doc(css).fontFaces[0]!.sources, new Set([0, 1, 2]))).toEqual([]);
    expect(removalSpans(doc('@font-face { src: url(a.woff2); }').fontFaces[0]!.sources, new Set([0]))).toEqual([]);
  });

  test('dropping nothing is a no-op', () => {
    expect(removalSpans(doc(css).fontFaces[0]!.sources, new Set())).toEqual([]);
  });
});

describe('parseUnicodeRange', () => {
  test.each([
    ['U+0131', 0x0131, 0x0131],
    ['U+0000-00FF', 0x0000, 0x00ff],
    ['U+00??', 0x0000, 0x00ff],
    ['u+4??', 0x400, 0x4ff],
    ['U+0400-045F', 0x0400, 0x045f],
  ])('%s', (text, lo, hi) => {
    expect(parseUnicodeRange(text)).toEqual({ lo, hi });
  });

  test.each(['0000-00FF', 'U+', 'U+xyz', 'U+1234567', ''])('rejects %p', (text) => {
    expect(parseUnicodeRange(text)).toBeNull();
  });

  test('a face reports every declared range, and none when the descriptor is absent', () => {
    expect(doc('@font-face { unicode-range: U+0400-045F, U+0490-0491; }').fontFaces[0]!.unicodeRanges).toEqual([
      { lo: 0x400, hi: 0x45f },
      { lo: 0x490, hi: 0x491 },
    ]);
    expect(doc('@font-face { src: url(a.woff2); }').fontFaces[0]!.unicodeRanges).toBeNull();
  });
});

describe('parseDataUri', () => {
  test('splits mime from payload', () => {
    expect(parseDataUri('data:font/woff2;base64,AAAA==')).toEqual({ mime: 'font/woff2', base64: 'AAAA==' });
  });

  test('accepts an empty payload', () => {
    expect(parseDataUri('data:font/woff;base64,')).toEqual({ mime: 'font/woff', base64: '' });
  });

  test.each(['https://cdn.example.com/a.woff2', 'data:font/woff2,notbase64', 'data:;base64,AAAA', 'data:image/png;charset=utf-8;base64,AA'])('rejects %p', (value) => {
    expect(parseDataUri(value)).toBeNull();
  });
});
