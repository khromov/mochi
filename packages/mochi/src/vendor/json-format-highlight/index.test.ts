import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/' });

import { afterAll, describe, expect, test } from 'bun:test';
import formatHighlight from './index.ts';

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function render(value: unknown) {
  const pre = document.createElement('pre');
  pre.innerHTML = formatHighlight(value, { keyColor: 'k', stringColor: 's' });
  return pre;
}

const hostile = ['<img src=x onerror=alert(1)>', '</pre><script>alert(1)</script>', 'a & b', '"quoted" & <tag>', '&lt;already&gt;'];

describe('formatHighlight', () => {
  test('keys never become markup', () => {
    for (const s of hostile) {
      const value = { [s]: 1 };
      const pre = render(value);
      expect(pre.querySelector('img, script')).toBeNull();
      expect(pre.textContent).toBe(JSON.stringify(value, null, 2));
    }
  });

  test('values never become markup', () => {
    for (const s of hostile) {
      const value = { key: s, list: [s] };
      const pre = render(value);
      expect(pre.querySelector('img, script')).toBeNull();
      expect(pre.textContent).toBe(JSON.stringify(value, null, 2));
    }
  });

  test('still colours keys and string values separately', () => {
    const pre = render({ '<k>': '<v>' });
    const spans = [...pre.querySelectorAll('span')];
    expect(spans.map((s) => [s.getAttribute('style'), s.textContent])).toEqual([
      ['color:k', '"<k>":'],
      ['word-wrap:break-word;white-space:pre-wrap;color:s', '"<v>"'],
    ]);
  });
});
