import { describe, expect, test } from 'bun:test';
import { parse as devalueParse, stringify as devalueStringify } from 'devalue';
import { emitIslandProps, injectIslandPropsScripts, type IslandPropsEntry } from './islandPropsRegistry';
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

describe('injectIslandPropsScripts', () => {
  test('empty registry leaves the html unchanged', () => {
    const html = '<div>no islands</div>';
    expect(injectIslandPropsScripts(html, new Map())).toBe(html);
  });

  test('emits a <script> block immediately before a single-use island, keeping props-ref', () => {
    const value = { s: '</script><img src=x>', q: 'he said "hi"', amp: '&amp; & &quot;' };
    const json = devalueStringify(value);
    const reg: Registry = new Map([[json, { id: 'mochi-props-0', count: 1 }]]);
    const html = '<mochi-hydratable-island component-name="Demo" component-url="/c/Demo.js" props-ref="mochi-props-0"><div>hi</div></mochi-hydratable-island>';

    const out = injectIslandPropsScripts(html, reg);
    // The block sits directly before the island and the island keeps its ref —
    // no inline `props=` attribute is produced.
    const block = out.match(/<script type="application\/json" id="mochi-props-0">([\s\S]*?)<\/script>/);
    expect(block).not.toBeNull();
    expect(out.indexOf('</script>')).toBeLessThan(out.indexOf('<mochi-hydratable-island'));
    expect(out).toContain('props-ref="mochi-props-0"');
    expect(out).not.toContain(' props="');
    // The script text round-trips back to the original value, with `<` escaped.
    expect(devalueParse(block![1]!.replace(/\\u003C/g, '<'))).toEqual(value);
    expect(block![1]).not.toMatch(/</);
  });

  test('shared payload: one block before the FIRST island, later islands keep their ref', () => {
    const reg: Registry = new Map([['{"a":1}', { id: 'mochi-props-0', count: 2 }]]);
    const html =
      '<mochi-hydratable-island component-name="A" props-ref="mochi-props-0"></mochi-hydratable-island>' +
      '<mochi-hydratable-island component-name="B" props-ref="mochi-props-0"></mochi-hydratable-island>';
    const out = injectIslandPropsScripts(html, reg);
    const blocks = out.match(/<script type="application\/json" id="mochi-props-0">/g);
    expect(blocks).toHaveLength(1);
    // Block precedes the first island; both islands retain props-ref.
    expect(out.indexOf('<script')).toBeLessThan(out.indexOf('component-name="A"'));
    expect(out.match(/props-ref="mochi-props-0"/g)).toHaveLength(2);
  });

  test('full-id match: mochi-props-1 does not capture mochi-props-10', () => {
    const reg: Registry = new Map([
      ['{"a":1}', { id: 'mochi-props-1', count: 1 }],
      ['{"b":2}', { id: 'mochi-props-10', count: 1 }],
    ]);
    const html =
      '<mochi-hydratable-island component-name="A" props-ref="mochi-props-1"></mochi-hydratable-island>' +
      '<mochi-hydratable-island component-name="B" props-ref="mochi-props-10"></mochi-hydratable-island>';
    const out = injectIslandPropsScripts(html, reg);
    expect(out).toContain('<script type="application/json" id="mochi-props-1">{"a":1}</script>');
    expect(out).toContain('<script type="application/json" id="mochi-props-10">{"b":2}</script>');
  });

  test('does not match a literal props-ref string in page text outside an island tag', () => {
    const reg: Registry = new Map([['{"a":1}', { id: 'mochi-props-0', count: 1 }]]);
    const html = '<p>each island gets props-ref="mochi-props-0" pointing at a block</p>';
    expect(injectIslandPropsScripts(html, reg)).toBe(html);
  });

  test('escapes `<` inside the payload so the block cannot terminate early', () => {
    const reg: Registry = new Map([['{"html":"</script><img src=x>"}', { id: 'mochi-props-0', count: 1 }]]);
    const html = '<mochi-hydratable-island component-name="X" props-ref="mochi-props-0"></mochi-hydratable-island>';
    const out = injectIslandPropsScripts(html, reg);
    const block = out.match(/<script type="application\/json" id="mochi-props-0">([\s\S]*?)<\/script>/);
    expect(block).not.toBeNull();
    expect(block![1]).toContain('\\u003C/script>');
    expect(block![1]).toContain('\\u003Cimg src=x>');
    expect(block![1]).not.toMatch(/</);
  });
});

describe('emitIslandProps + injectIslandPropsScripts (integration)', () => {
  test('full flow: shared payload gets one block before its first island, single-use gets its own', () => {
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
      const out = injectIslandPropsScripts(html, ctx.islandProps);

      // No inline props attributes; every island keeps its ref.
      expect(out).not.toContain(' props="');
      expect(out.match(new RegExp(`props-ref="${a}"`, 'g'))).toHaveLength(2);
      expect(out).toContain(`props-ref="${solo}"`);

      // One block per unique payload (shared one emitted once, before the first island).
      expect(out.match(new RegExp(`id="${a}"`, 'g'))).toHaveLength(1);
      expect(out.match(new RegExp(`id="${solo}"`, 'g'))).toHaveLength(1);
      expect(out.indexOf(`id="${a}"`)).toBeLessThan(out.indexOf('component-name="A"'));
      expect(out.indexOf(`id="${solo}"`)).toBeLessThan(out.indexOf('component-name="C"'));
    });
  });
});
