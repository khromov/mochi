import { describe, expect, test } from 'bun:test';
import { minifyHtml } from './htmlMinify';

const CFG = { minifyCss: false, minifyJs: false };

describe('minifyHtml() (@minify-html/wasm)', () => {
  test('collapses inter-element whitespace and omits optional closing tags', async () => {
    expect(await minifyHtml('<div>\n  <p>hi</p>\n\n  <p>bye</p>\n</div>', CFG)).toBe('<div><p>hi<p>bye</div>');
  });

  test('preserves <pre> contents verbatim while collapsing around it', async () => {
    expect(await minifyHtml('<div>\n  <pre>  keep   these\n  spaces  </pre>\n</div>', CFG)).toBe('<div><pre>  keep   these\n  spaces  </pre></div>');
  });

  test('preserves Svelte hydration markers (keep_comments)', async () => {
    expect(await minifyHtml('<div><!--[-->x<!--]--></div>', CFG)).toBe('<div><!--[-->x<!--]--></div>');
  });

  test('keeps author comments too — the cost of keep_comments', async () => {
    expect(await minifyHtml('<div><!-- author -->x</div>', CFG)).toBe('<div><!-- author -->x</div>');
  });

  test('preserves island subtrees byte-for-byte while minifying around them (hydration safety)', async () => {
    const island = '<div>\n  <mochi-hydratable-island component-name="A"><!--[--><span>  a  b  </span><!--]--></mochi-hydratable-island>\n  <p>   outside   </p>\n</div>';
    // Island internals (incl. the `  a  b  ` spacing) survive untouched; the non-island body is collapsed.
    expect(await minifyHtml(island, CFG)).toBe('<div><mochi-hydratable-island component-name="A"><!--[--><span>  a  b  </span><!--]--></mochi-hydratable-island><p>outside</div>');
  });

  test('preserves a nested island (server island inside a hydratable island) as one unit', async () => {
    const nested = '<div>\n  <mochi-hydratable-island><!--[--><mochi-server-island><!--[--><b>  x  y  </b><!--]--></mochi-server-island><!--]--></mochi-hydratable-island>\n</div>';
    expect(await minifyHtml(nested, CFG)).toBe(
      '<div><mochi-hydratable-island><!--[--><mochi-server-island><!--[--><b>  x  y  </b><!--]--></mochi-server-island><!--]--></mochi-hydratable-island></div>',
    );
  });

  test('leaves no island placeholder tokens in the output', async () => {
    const island = '<div><mochi-hydratable-island><!--[-->hi<!--]--></mochi-hydratable-island></div>';
    expect(await minifyHtml(island, CFG)).not.toContain('__mochi_island_');
  });

  test('shrinks a full document', async () => {
    const doc = '<!doctype html>\n<html>\n  <head>\n    <title>Hi</title>\n  </head>\n  <body>\n    <p>Hello   world</p>\n  </body>\n</html>';
    const out = await minifyHtml(doc, CFG);
    expect(out.length).toBeLessThan(doc.length);
    expect(out).toContain('<title>Hi</title>');
  });

  test('minifyJs config reaches the minifier (inline script tightened)', async () => {
    const src = '<script>const   x   =   1 ;</script>';
    const off = await minifyHtml(src, CFG);
    const on = await minifyHtml(src, { minifyCss: false, minifyJs: true });
    expect(on.length).toBeLessThan(off.length);
  });

  test('minifyCss config reaches the minifier (inline style tightened)', async () => {
    const src = '<style>.a {  color:  red ;  }</style>';
    const off = await minifyHtml(src, CFG);
    const on = await minifyHtml(src, { minifyCss: true, minifyJs: false });
    expect(on.length).toBeLessThan(off.length);
  });
});
