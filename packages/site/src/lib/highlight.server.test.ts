import { describe, expect, test } from 'bun:test';
import { highlightCode } from './highlight.server';

describe('highlightCode', () => {
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

  // Every fence language the docs and demo sources actually use, so a missing grammar fails here
  // rather than silently rendering a page's code blocks as plaintext.
  test.each([
    ['ts', 'const a = 1;'],
    ['typescript', 'const a = 1;'],
    ['js', 'const a = 1;'],
    ['svelte', '<p>hi</p>'],
    ['html', '<p>hi</p>'],
    ['sh', 'echo "hi"'],
    ['bash', 'echo "hi"'],
    ['json', '{ "a": 1 }'],
    ['css', 'p { color: red; }'],
    ['toml', 'a = 1'],
    ['yaml', 'a: 1'],
  ])('highlights %s', (lang, code) => {
    expect(highlightCode(code, lang)).toContain('class="tok ');
  });

  test('escapes an unregistered language instead of throwing', () => {
    expect(highlightCode('<b>', 'brainfuck')).toContain('<pre class="twinkleplop"><code>&lt;b&gt;</code></pre>');
  });
});
