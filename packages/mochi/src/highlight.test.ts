import { describe, expect, test } from 'bun:test';
import { createHighlighter, createTwinkleplopHighlighter } from './highlight';

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

describe('createTwinkleplopHighlighter', () => {
  const fakeLanguage = (name: string) => () => (code: string) => `<pre class="twinkleplop">${name}:${code}</pre>`;

  test('resolves built-in aliases to the canonical grammar', () => {
    const highlight = createTwinkleplopHighlighter({
      languages: { typescript: fakeLanguage('typescript'), bash: fakeLanguage('bash'), html: fakeLanguage('html') },
    });
    expect(highlight('x', 'ts')).toContain('typescript:x');
    expect(highlight('x', 'sh')).toContain('bash:x');
    expect(highlight('x', 'dockerfile')).toContain('bash:x');
    expect(highlight('x', 'xml')).toContain('html:x');
  });

  test('caller aliases override the built-in table', () => {
    const highlight = createTwinkleplopHighlighter({
      languages: { bash: fakeLanguage('bash'), typescript: fakeLanguage('typescript') },
      aliases: { ts: 'bash' },
    });
    expect(highlight('x', 'ts')).toContain('bash:x');
  });

  test('renders an unregistered language as escaped plaintext instead of throwing', () => {
    const highlight = createTwinkleplopHighlighter({ languages: {} });
    const html = highlight('<b> & "q"', 'brainfuck');
    expect(html).toContain('<pre class="twinkleplop"><code>&lt;b&gt; &amp; &quot;q&quot;</code></pre>');
    expect(html).toContain('<div class="code-block">');
  });

  test('an absent language falls through to the plaintext path', () => {
    const highlight = createTwinkleplopHighlighter({ languages: { typescript: fakeLanguage('typescript') } });
    expect(highlight('x')).toContain('<pre class="twinkleplop"><code>x</code></pre>');
  });

  test('instantiates each grammar once, on first use', () => {
    let bashCalls = 0;
    let tsCalls = 0;
    const highlight = createTwinkleplopHighlighter({
      languages: {
        bash: () => {
          bashCalls += 1;
          return (code) => code;
        },
        typescript: () => {
          tsCalls += 1;
          return (code) => code;
        },
      },
      cacheSize: 0,
    });
    highlight('a', 'sh');
    highlight('b', 'bash');
    expect(bashCalls).toBe(1);
    expect(tsCalls).toBe(0);
  });

  test('forwards lineNumbers to the grammar renderer', () => {
    const seen: unknown[] = [];
    const languages = {
      typescript: () => (code: string, options?: { line_numbers?: boolean }) => {
        seen.push(options);
        return code;
      },
    };
    createTwinkleplopHighlighter({ languages, lineNumbers: true })('x', 'ts');
    createTwinkleplopHighlighter({ languages })('x', 'ts');
    expect(seen).toEqual([{ line_numbers: true }, undefined]);
  });

  test('wraps and memoizes like createHighlighter', () => {
    let calls = 0;
    const highlight = createTwinkleplopHighlighter({
      languages: {
        typescript: () => (code) => {
          calls += 1;
          return `<pre>${code}</pre>`;
        },
      },
    });
    const first = highlight('const a = { b };', 'ts');
    expect(highlight('const a = { b };', 'ts')).toBe(first);
    expect(calls).toBe(1);
    expect(first).toContain('class="code-copy"');
    expect(first).toContain('&#123; b &#125;');
  });
});
