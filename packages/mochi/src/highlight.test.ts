import { describe, expect, test } from 'bun:test';
import { createHighlighter } from './highlight';

describe('createHighlighter', () => {
  test('wraps highlighted HTML in the code-block shell and escapes Svelte braces', () => {
    const highlight = createHighlighter((code) => `<pre>${code}</pre>`);
    const html = highlight('const a = { b };', 'ts') as string;
    expect(html).toContain('<div class="code-block">');
    expect(html).toContain('class="code-copy"');
    expect(html).toContain('&#123; b &#125;');
    expect(html).not.toContain('{ b }');
  });

  test('defaults an absent language to plaintext', () => {
    const seen: string[] = [];
    const highlight = createHighlighter((code, lang) => {
      seen.push(lang);
      return code;
    });
    highlight('x');
    highlight('y', null);
    expect(seen).toEqual(['plaintext', 'plaintext']);
  });

  test('memoizes per (code, lang) so repeated renders highlight once', () => {
    let calls = 0;
    const highlight = createHighlighter((code) => {
      calls++;
      return code;
    });
    expect(highlight('same', 'ts')).toBe(highlight('same', 'ts'));
    expect(calls).toBe(1);

    highlight('same', 'css');
    expect(calls).toBe(2);
    highlight('different', 'ts');
    expect(calls).toBe(3);
  });

  test('memoizes async engines, sharing one pass between concurrent callers', async () => {
    let calls = 0;
    const highlight = createHighlighter(async (code) => {
      calls++;
      await Promise.resolve();
      return code;
    });
    const [a, b] = await Promise.all([highlight('x', 'ts'), highlight('x', 'ts')]);
    expect(a).toBe(b);
    expect(await highlight('x', 'ts')).toBe(a);
    expect(calls).toBe(1);
  });

  test('does not cache a failed pass', async () => {
    let calls = 0;
    const highlight = createHighlighter(async () => {
      calls++;
      if (calls === 1) {
        throw new Error('boom');
      }
      return 'ok';
    });
    await expect(highlight('x', 'ts')).rejects.toThrow('boom');
    expect(await highlight('x', 'ts')).toContain('ok');
    expect(calls).toBe(2);
  });

  test('evicts in insertion order once cacheSize is reached', () => {
    let calls = 0;
    const highlight = createHighlighter(
      (code) => {
        calls++;
        return code;
      },
      { cacheSize: 2 },
    );
    highlight('a', 'ts');
    highlight('b', 'ts');
    expect(calls).toBe(2);
    highlight('a', 'ts'); // still cached
    expect(calls).toBe(2);
    highlight('c', 'ts'); // evicts 'a'
    highlight('a', 'ts');
    expect(calls).toBe(4);
  });

  test('cacheSize: 0 disables memoization', () => {
    let calls = 0;
    const highlight = createHighlighter(
      (code) => {
        calls++;
        return code;
      },
      { cacheSize: 0 },
    );
    highlight('a', 'ts');
    highlight('a', 'ts');
    expect(calls).toBe(2);
  });
});
