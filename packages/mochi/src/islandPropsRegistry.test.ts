import { describe, expect, test } from 'bun:test';
import { parse as devalueParse, stringify as devalueStringify } from 'devalue';
import { buildIslandPropsScripts, emitIslandProps, inlineSingleUseProps, type IslandPropsEntry } from './islandPropsRegistry';
import { unescapeHtmlAttr } from './htmlEscape';
import { requestContext, type MochiRequestContext } from './requestContext';
import { MochiCookieJar } from './cookies';

function makeCtx(opts?: { dev?: boolean }): MochiRequestContext {
  return {
    requestId: 'test',
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
    params: {},
    locals: {},
    isWarmup: false,
    cookies: new MochiCookieJar(null),
    islandProps: new Map(),
    debugBarData: opts?.dev ? { route: '/', pathname: '/', params: {} } : undefined,
    getClientAddress: () => null,
  };
}

function withCtx<T>(fn: (ctx: MochiRequestContext) => T, opts?: { dev?: boolean }): T {
  const ctx = makeCtx(opts);
  return requestContext.run(ctx, () => fn(ctx));
}

describe('devalueParse isolation', () => {
  // Kept from the previous islandPropsDedup test suite: confirms that two parses
  // of the same serialized payload produce independent object graphs. This is
  // the invariant that lets multiple islands share a single <script> block
  // without mutations on one island leaking to another after hydration.
  test('two parse calls on the same string return independent object graphs', () => {
    const serialized = devalueStringify({ items: [1, 2, 3], nested: { x: 0 } });

    const a = devalueParse(serialized) as { items: number[]; nested: { x: number } };
    const b = devalueParse(serialized) as { items: number[]; nested: { x: number } };

    expect(a).not.toBe(b);
    expect(a.items).not.toBe(b.items);
    expect(a.nested).not.toBe(b.nested);

    a.items.push(99);
    a.nested.x = 42;

    expect(b.items).toEqual([1, 2, 3]);
    expect(b.nested.x).toBe(0);
  });
});

describe('emitIslandProps', () => {
  test('identical payloads share a single ref id', () => {
    withCtx((ctx) => {
      const id1 = emitIslandProps({ count: 5, title: 'Hello' });
      const id2 = emitIslandProps({ count: 5, title: 'Hello' });
      expect(id1).toBe(id2);
      expect(ctx.islandProps.size).toBe(1);
      expect([...ctx.islandProps.values()][0]!.count).toBe(2);
    });
  });

  test('distinct payloads get distinct sequential ref ids', () => {
    withCtx((ctx) => {
      const a = emitIslandProps({ x: 1 });
      const b = emitIslandProps({ x: 2 });
      const c = emitIslandProps({ x: 3 });
      expect(a).toBe('mochi-props-0');
      expect(b).toBe('mochi-props-1');
      expect(c).toBe('mochi-props-2');
      expect(ctx.islandProps.size).toBe(3);
      expect([...ctx.islandProps.values()].map((e) => e.count)).toEqual([1, 1, 1]);
    });
  });

  test('mix of repeats and uniques: ids are stable, registry only stores uniques', () => {
    withCtx((ctx) => {
      const shared = { items: [1, 2, 3] };
      const a = emitIslandProps(shared);
      const b = emitIslandProps({ solo: true });
      const c = emitIslandProps(shared);
      expect(a).toBe('mochi-props-0');
      expect(b).toBe('mochi-props-1');
      expect(c).toBe('mochi-props-0');
      expect(ctx.islandProps.size).toBe(2);
      expect([...ctx.islandProps.values()].map((e) => e.count)).toEqual([2, 1]);
    });
  });

  test('throws when called outside a request context', () => {
    expect(() => emitIslandProps({ x: 1 })).toThrow(/outside of a request/);
  });

  test('two requests have independent registries', () => {
    const id1 = withCtx(() => emitIslandProps({ shared: 'value' }));
    const id2 = withCtx(() => emitIslandProps({ shared: 'value' }));
    // Same payload, but each request started fresh — both should get id 0.
    expect(id1).toBe('mochi-props-0');
    expect(id2).toBe('mochi-props-0');
  });
});

type Registry = Map<string, IslandPropsEntry>;

describe('buildIslandPropsScripts', () => {
  test('empty registry yields the empty string', () => {
    expect(buildIslandPropsScripts(new Map())).toBe('');
  });

  test('emits one <script> block per shared registry entry, in insertion order', () => {
    const reg: Registry = new Map([
      ['{"a":1}', { id: 'mochi-props-0', count: 2 }],
      ['{"b":2}', { id: 'mochi-props-1', count: 3 }],
    ]);
    const out = buildIslandPropsScripts(reg);
    expect(out).toBe('<script type="application/json" id="mochi-props-0">{"a":1}</script>' + '<script type="application/json" id="mochi-props-1">{"b":2}</script>');
  });

  test('skips single-use entries (they are inlined instead)', () => {
    const reg: Registry = new Map([
      ['{"a":1}', { id: 'mochi-props-0', count: 1 }],
      ['{"b":2}', { id: 'mochi-props-1', count: 2 }],
      ['{"c":3}', { id: 'mochi-props-2', count: 1 }],
    ]);
    const out = buildIslandPropsScripts(reg);
    expect(out).toBe('<script type="application/json" id="mochi-props-1">{"b":2}</script>');
  });

  test('all-single-use registry yields the empty string', () => {
    const reg: Registry = new Map([['{"a":1}', { id: 'mochi-props-0', count: 1 }]]);
    expect(buildIslandPropsScripts(reg)).toBe('');
  });

  test('escapes `<` characters inside the JSON payload', () => {
    const reg: Registry = new Map([['{"html":"</script><img src=x>"}', { id: 'mochi-props-0', count: 2 }]]);
    const out = buildIslandPropsScripts(reg);
    // Every `<` in the payload becomes the `<` JSON unicode escape …
    const block = out.match(/<script type="application\/json" id="mochi-props-0">([\s\S]*?)<\/script>/);
    expect(block).not.toBeNull();
    expect(block![1]).toContain('\\u003C/script>');
    expect(block![1]).toContain('\\u003Cimg src=x>');
    // … so no raw `<` (and therefore no `</script`) survives inside the block.
    expect(block![1]).not.toMatch(/</);
  });
});

describe('inlineSingleUseProps', () => {
  test('rewrites a single-use props-ref to an inline props attribute that round-trips', () => {
    const value = { s: '</script><img src=x>', q: 'he said "hi"', amp: '&amp; & &quot;' };
    const json = devalueStringify(value);
    const reg: Registry = new Map([[json, { id: 'mochi-props-0', count: 1 }]]);
    const html =
      '<mochi-hydratable-island island-id="mochi-a-0" component-name="Demo" component-url="/c/Demo.js" props-ref="mochi-props-0"><div>hi</div></mochi-hydratable-island>';

    const out = inlineSingleUseProps(html, reg);
    expect(out).not.toContain('props-ref');
    const attr = out.match(/ props="([^"]*)"/);
    expect(attr).not.toBeNull();
    expect(devalueParse(unescapeHtmlAttr(attr![1]!))).toEqual(value);
    // No raw `<` or `"` from the payload may leak into the attribute value.
    expect(attr![1]).not.toMatch(/[<"]/);
  });

  test('leaves shared entries untouched', () => {
    const reg: Registry = new Map([['{"a":1}', { id: 'mochi-props-0', count: 2 }]]);
    const html = '<mochi-hydratable-island component-name="Demo" props-ref="mochi-props-0"></mochi-hydratable-island>';
    expect(inlineSingleUseProps(html, reg)).toBe(html);
  });

  test('full-id match: mochi-props-1 (shared) does not capture mochi-props-10 (single)', () => {
    const reg: Registry = new Map([
      ['{"a":1}', { id: 'mochi-props-1', count: 2 }],
      ['{"b":2}', { id: 'mochi-props-10', count: 1 }],
    ]);
    const html =
      '<mochi-hydratable-island component-name="A" props-ref="mochi-props-1"></mochi-hydratable-island>' +
      '<mochi-hydratable-island component-name="B" props-ref="mochi-props-10"></mochi-hydratable-island>';
    const out = inlineSingleUseProps(html, reg);
    expect(out).toContain('props-ref="mochi-props-1"');
    expect(out).not.toContain('props-ref="mochi-props-10"');
    expect(out).toContain('props="{&quot;b&quot;:2}"');
  });

  test('does not rewrite a literal props-ref string in page text outside an island tag', () => {
    const reg: Registry = new Map([['{"a":1}', { id: 'mochi-props-0', count: 1 }]]);
    const html = '<p>each island gets props-ref="mochi-props-0" pointing at a block</p>';
    expect(inlineSingleUseProps(html, reg)).toBe(html);
  });

  test('returns the html unchanged when nothing is single-use', () => {
    const reg: Registry = new Map([['{"a":1}', { id: 'mochi-props-0', count: 2 }]]);
    const html = '<div>no islands</div>';
    expect(inlineSingleUseProps(html, reg)).toBe(html);
  });
});

describe('emitIslandProps + buildIslandPropsScripts + inlineSingleUseProps (integration)', () => {
  test('full flow: shared payload keeps its block, unique payload is inlined', () => {
    withCtx((ctx) => {
      const a = emitIslandProps({ readmeToc: [{ level: 1, text: 'hi', slug: 'hi' }], demos: [] });
      const b = emitIslandProps({ readmeToc: [{ level: 1, text: 'hi', slug: 'hi' }], demos: [] });
      const solo = emitIslandProps({ defaultUsername: 'mochi_fan' });
      expect(a).toBe(b);
      expect(solo).not.toBe(a);

      const html =
        `<mochi-hydratable-island component-name="A" props-ref="${a}"></mochi-hydratable-island>` +
        `<mochi-hydratable-island component-name="B" props-ref="${b}"></mochi-hydratable-island>` +
        `<mochi-hydratable-island component-name="C" props-ref="${solo}"></mochi-hydratable-island>`;
      const inlined = inlineSingleUseProps(html, ctx.islandProps);
      expect(inlined.match(new RegExp(`props-ref="${a}"`, 'g'))).toHaveLength(2);
      expect(inlined).not.toContain(`props-ref="${solo}"`);
      const attr = inlined.match(/ props="([^"]*)"/);
      expect(attr).not.toBeNull();
      expect(devalueParse(unescapeHtmlAttr(attr![1]!))).toEqual({ defaultUsername: 'mochi_fan' });

      const scripts = buildIslandPropsScripts(ctx.islandProps);
      const blockMatches = scripts.match(/<script type="application\/json" id="mochi-props-\d+">/g);
      expect(blockMatches).toHaveLength(1);
      expect(scripts).toContain(`id="${a}"`);
      expect(scripts).not.toContain(`id="${solo}"`);
    });
  });
});
