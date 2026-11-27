import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { getLogLevel, setLogLevel } from 'mochi-framework';
import { createGrammarHighlighter, highlightCode } from './highlight.server';

describe('highlightCode', () => {
  // The fallback paths log a warning; silence it so the suite output stays clean.
  let prevLevel: ReturnType<typeof getLogLevel>;
  beforeAll(() => {
    prevLevel = getLogLevel();
    setLogLevel('silent');
  });
  afterAll(() => setLogLevel(prevLevel));

  test('tokenizes TypeScript through the ts alias', () => {
    const html = highlightCode('const answer = 42;', 'ts');
    expect(html).toContain('<pre class="twinkleplop">');
    expect(html).toContain('class="tok keyword"');
    expect(html).toContain('class="tok number"');
    expect(html).toContain('<div class="code-block">');
  });

  test('tokenizes Svelte markup, script, and style in one pass', () => {
    const html = highlightCode('<script>let a = 1;<' + '/script>\n<p>hi</p>\n<style>p { color: red; }</style>', 'svelte');
    expect(html).toContain('class="tok tag_name"');
    expect(html).toContain('class="tok keyword"');
    expect(html).toContain('class="tok property"');
  });

  // Every fence language the docs and demo sources actually use, so a missing grammar or alias fails
  // here rather than silently rendering a page's code blocks as plaintext.
  test.each([
    ['ts', 'const a = 1;'],
    ['typescript', 'const a = 1;'],
    ['js', 'const a = 1;'],
    ['svelte', '<p>hi</p>'],
    ['html', '<p>hi</p>'],
    ['xml', '<p>hi</p>'],
    ['sh', 'echo "hi"'],
    ['bash', 'echo "hi"'],
    ['dockerfile', 'RUN echo "hi"'],
    ['json', '{ "a": 1 }'],
    ['css', 'p { color: red; }'],
    ['toml', 'a = 1'],
    ['yaml', 'a: 1'],
  ])('highlights %s', (lang, code) => {
    expect(highlightCode(code, lang)).toContain('class="tok ');
  });

  test('renders an unregistered language as escaped plaintext instead of throwing', () => {
    const html = highlightCode('<b> & "q"', 'brainfuck');
    expect(html).toContain('<pre class="twinkleplop"><code>&lt;b&gt; &amp; &quot;q&quot;</code></pre>');
    expect(html).toContain('<div class="code-block">');
  });

  test('an absent language falls through to the plaintext path', () => {
    expect(highlightCode('a = 1')).toContain('<pre class="twinkleplop"><code>a = 1</code></pre>');
  });

  test('memoizes per (code, lang) and escapes Svelte braces', () => {
    const first = highlightCode('const a = { b };', 'ts');
    expect(highlightCode('const a = { b };', 'ts')).toBe(first);
    expect(first).toContain('&#123;');
    expect(first).toContain('&#125;');
    expect(first).not.toContain('{');
  });

  test('a fence named after an Object.prototype member falls through to plaintext', () => {
    for (const lang of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(highlightCode('x', lang)).toContain('<pre class="twinkleplop"><code>x</code></pre>');
    }
  });

  test('degrades to plaintext when a grammar throws instead of 500ing the page', () => {
    const highlight = createGrammarHighlighter(
      {
        typescript: () => () => {
          throw new Error('boom');
        },
      },
      { ts: 'typescript' },
    );
    const html = highlight('<b> & "q"', 'ts');
    expect(html).toContain('<pre class="twinkleplop"><code>&lt;b&gt; &amp; &quot;q&quot;</code></pre>');
    expect(html).toContain('<div class="code-block">');
  });
});
