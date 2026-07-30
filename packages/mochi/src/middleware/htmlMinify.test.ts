import { describe, expect, test } from 'bun:test';
import { minifyHtml } from './htmlMinify';

const ALL = { collapseWhitespace: true, removeComments: true };

describe('minifyHtml()', () => {
  test('collapses inter-element whitespace to single spaces', () => {
    const out = minifyHtml('<div>\n  <p>hi</p>\n\n  <p>bye</p>\n</div>', ALL);
    expect(out).toBe('<div> <p>hi</p> <p>bye</p> </div>');
  });

  test('conservatively keeps a single space between inline elements', () => {
    const out = minifyHtml('<p><a>a</a>   <a>b</a></p>', ALL);
    expect(out).toBe('<p><a>a</a> <a>b</a></p>');
  });

  test('preserves <pre> contents byte-for-byte, including nested elements', () => {
    const html = '<div>\n  <pre>  keep   <code>nested  spaces</code>\n  line2  </pre>\n</div>';
    const out = minifyHtml(html, ALL);
    expect(out).toContain('<pre>  keep   <code>nested  spaces</code>\n  line2  </pre>');
  });

  test('preserves <textarea>, <script>, and <style> contents', () => {
    expect(minifyHtml('<textarea>  a  b  </textarea>', ALL)).toBe('<textarea>  a  b  </textarea>');
    expect(minifyHtml('<script>  const x =   1;  </script>', ALL)).toBe('<script>  const x =   1;  </script>');
    expect(minifyHtml('<style>  .a  {  color: red;  }  </style>', ALL)).toBe('<style>  .a  {  color: red;  }  </style>');
  });

  test('leaves island subtree whitespace and comments untouched (hydration safety)', () => {
    const island = '<mochi-hydratable-island>\n  <!--[-->\n  <span>  child  </span>\n  <!-- author note -->\n  <!--]-->\n</mochi-hydratable-island>';
    const html = `<div>\n  ${island}\n</div>`;
    const out = minifyHtml(html, ALL);
    expect(out).toContain(island);
  });

  test('leaves server-island subtree untouched', () => {
    const island = '<mochi-server-island>\n  <p>  spaced  </p>\n  <!-- keep -->\n</mochi-server-island>';
    const out = minifyHtml(island, ALL);
    expect(out).toBe(island);
  });

  test('strips author comments outside islands', () => {
    const out = minifyHtml('<div><!-- author comment -->x</div>', ALL);
    expect(out).toBe('<div>x</div>');
  });

  test('keeps Svelte hydration marker comments even outside islands', () => {
    const out = minifyHtml('<div><!--[-->x<!--]--></div>', ALL);
    expect(out).toBe('<div><!--[-->x<!--]--></div>');
  });

  test('removeComments: false keeps author comments', () => {
    const out = minifyHtml('<div><!-- keep me -->x</div>', { collapseWhitespace: true, removeComments: false });
    expect(out).toBe('<div><!-- keep me -->x</div>');
  });

  test('collapseWhitespace: false leaves whitespace intact', () => {
    const html = '<div>\n  <p>hi</p>\n</div>';
    const out = minifyHtml(html, { collapseWhitespace: false, removeComments: true });
    expect(out).toBe(html);
  });
});
