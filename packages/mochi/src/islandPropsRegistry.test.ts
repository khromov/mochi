import { describe, expect, test } from 'bun:test';
import { parse as devalueParse, stringify as devalueStringify } from 'devalue';
import { buildIslandPropsScripts, emitIslandProps } from './islandPropsRegistry';
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
    debugBarData: opts?.dev ? { route: '/', pathname: '/', params: {}, islandProps: {} } : undefined,
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

  test('records pretty-printed JSON in debugBarData.islandProps when islandId given (dev)', () => {
    withCtx(
      (ctx) => {
        emitIslandProps({ count: 5, title: 'Hello' }, 'mochi-abc-0');
        const pretty = ctx.debugBarData!.islandProps['mochi-abc-0'];
        expect(pretty).toBeDefined();
        // Pretty-printed: contains newlines and indentation, parses back to original.
        expect(pretty!).toContain('\n');
        expect(pretty!).toContain('  ');
        // The recorded form is JSON of the devalue stringification — parsing it
        // yields the devalue array form, not the original object.
        expect(() => JSON.parse(pretty!)).not.toThrow();
      },
      { dev: true },
    );
  });

  test('does not touch debugBarData.islandProps when no islandId is supplied (dev)', () => {
    withCtx(
      (ctx) => {
        emitIslandProps({ x: 1 });
        expect(Object.keys(ctx.debugBarData!.islandProps)).toHaveLength(0);
      },
      { dev: true },
    );
  });

  test('is a no-op for debug recording when debugBarData is undefined (prod)', () => {
    withCtx((ctx) => {
      const id = emitIslandProps({ x: 1 }, 'mochi-abc-0');
      expect(id).toBe('mochi-props-0');
      expect(ctx.debugBarData).toBeUndefined();
    });
  });

  test('two islands with identical payloads share a ref id but record separate debug entries', () => {
    withCtx(
      (ctx) => {
        const a = emitIslandProps({ count: 5 }, 'mochi-abc-0');
        const b = emitIslandProps({ count: 5 }, 'mochi-abc-1');
        expect(a).toBe(b);
        expect(ctx.islandProps.size).toBe(1);
        const debugIslands = ctx.debugBarData!.islandProps;
        expect(Object.keys(debugIslands).sort()).toEqual(['mochi-abc-0', 'mochi-abc-1']);
        expect(debugIslands['mochi-abc-0']).toBe(debugIslands['mochi-abc-1']);
      },
      { dev: true },
    );
  });
});

describe('buildIslandPropsScripts', () => {
  test('empty registry yields the empty string', () => {
    expect(buildIslandPropsScripts(new Map())).toBe('');
  });

  test('emits one <script> block per registry entry, in insertion order', () => {
    const reg = new Map<string, string>([
      ['{"a":1}', 'mochi-props-0'],
      ['{"b":2}', 'mochi-props-1'],
    ]);
    const out = buildIslandPropsScripts(reg);
    expect(out).toBe('<script type="application/json" id="mochi-props-0">{"a":1}</script>' + '<script type="application/json" id="mochi-props-1">{"b":2}</script>');
  });

  test('escapes `<` characters inside the JSON payload', () => {
    const reg = new Map<string, string>([['{"html":"</script><img src=x>"}', 'mochi-props-0']]);
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

describe('emitIslandProps + buildIslandPropsScripts (integration)', () => {
  test('full flow: register two islands sharing a payload, hoist one script block', () => {
    withCtx((ctx) => {
      const a = emitIslandProps({ readmeToc: [{ level: 1, text: 'hi', slug: 'hi' }], demos: [] });
      const b = emitIslandProps({ readmeToc: [{ level: 1, text: 'hi', slug: 'hi' }], demos: [] });
      expect(a).toBe(b);

      const scripts = buildIslandPropsScripts(ctx.islandProps);
      const blockMatches = scripts.match(/<script type="application\/json" id="mochi-props-\d+">/g);
      expect(blockMatches).toHaveLength(1);
      expect(scripts).toContain(`id="${a}"`);
    });
  });
});
