import { describe, expect, test } from 'bun:test';
import { parse as devalueParse, stringify as devalueStringify } from 'devalue';
import { emitIslandProps, renderIslandPropsScript } from './islandPropsRegistry';
import { requestContext, type MochiRequestContext } from './requestContext';
import { MochiCookieJar } from './cookies';

function makeCtx(): MochiRequestContext {
  return {
    requestId: 'test',
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
    params: {},
    locals: {},
    isWarmup: false,
    cookies: new MochiCookieJar(null),
    islandProps: new Map(),
    debugBarData: undefined,
    getClientAddress: () => null,
  };
}

function withCtx<T>(fn: (ctx: MochiRequestContext) => T): T {
  const ctx = makeCtx();
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

describe('renderIslandPropsScript', () => {
  test('stamps data-shared only when two or more islands share the payload', () => {
    expect(renderIslandPropsScript('mochi-props-0', '{"a":1}', 1)).toBe('<script type="application/json" id="mochi-props-0">{"a":1}</script>');
    expect(renderIslandPropsScript('mochi-props-0', '{"a":1}', 2)).toBe('<script type="application/json" id="mochi-props-0" data-shared>{"a":1}</script>');
  });

  test('escapes `<` inside the payload so the block cannot terminate early, and round-trips', () => {
    const value = { html: '</script><img src=x>' };
    const out = renderIslandPropsScript('mochi-props-0', devalueStringify(value), 1);
    const body = out.match(/<script type="application\/json" id="mochi-props-0">([\s\S]*?)<\/script>/)![1]!;
    expect(body).toContain('\\u003C/script>');
    expect(body).toContain('\\u003Cimg src=x>');
    expect(body).not.toMatch(/</);
    // Reversing the `<` escape yields the original devalue payload.
    expect(devalueParse(body.replace(/\\u003C/g, '<'))).toEqual(value);
  });
});
