import { afterEach, describe, expect, test } from 'bun:test';
import { Packr, Unpackr } from 'msgpackr';
import { renderIslandPropsScript } from './islandPropsRegistry';
import { SPECIAL } from '../scripts/msgpack-bench/payloads';

// The exact wire contract the prototype relies on: the server emits
// base64(msgpackr.pack(props)) and the client does atob -> msgpackr.unpack. Both
// sides use { structuredClone: true } to match devalue's type coverage.
const encode = (v: unknown): string => Buffer.from(new Packr({ structuredClone: true }).pack(v)).toString('base64');
const decode = (b64: string): unknown => new Unpackr({ structuredClone: true }).unpack(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
const roundTrip = (v: unknown): unknown => decode(encode(v));

describe('msgpack island-props codec — wire round-trip', () => {
  test('Date is preserved', () => {
    const out = roundTrip({ createdAt: new Date('2026-06-21T12:34:56.000Z') }) as { createdAt: Date };
    expect(out.createdAt).toBeInstanceOf(Date);
    expect(out.createdAt.getTime()).toBe(new Date('2026-06-21T12:34:56.000Z').getTime());
  });

  test('Map is preserved', () => {
    const out = roundTrip({ byId: new Map([['a', 1]]) }) as { byId: Map<string, number> };
    expect(out.byId).toBeInstanceOf(Map);
    expect(out.byId.get('a')).toBe(1);
  });

  test('Set is preserved', () => {
    const out = roundTrip({ tags: new Set(['x', 'y']) }) as { tags: Set<string> };
    expect(out.tags).toBeInstanceOf(Set);
    expect(out.tags.has('y')).toBe(true);
  });

  test('explicit undefined property is preserved', () => {
    const out = roundTrip({ a: 1, b: undefined }) as { a: number; b: unknown };
    expect('b' in out).toBe(true);
    expect(out.b).toBeUndefined();
  });

  test('circular reference round-trips to a cycle', () => {
    const node: Record<string, unknown> = { id: 'root' };
    node.self = node;
    const out = roundTrip(node) as Record<string, unknown>;
    expect(out.self).toBe(out);
  });

  test('repeated reference keeps shared identity', () => {
    const shared = { theme: 'dark' };
    const out = roundTrip({ a: shared, b: shared }) as { a: unknown; b: unknown };
    expect(out.a).toBe(out.b);
  });

  test('every special-type payload round-trips without throwing', () => {
    for (const p of SPECIAL) {
      expect(() => roundTrip(p.value)).not.toThrow();
    }
  });

  test('plain props are byte-stable (dedup key holds)', () => {
    const props = { title: 'Dashboard', count: 7, tags: ['a', 'b'] };
    expect(encode(props)).toBe(encode({ title: 'Dashboard', count: 7, tags: ['a', 'b'] }));
    expect(roundTrip(props)).toEqual(props);
  });
});

describe('renderIslandPropsScript — self-describing block', () => {
  afterEach(() => {
    delete process.env.MOCHI_ISLAND_CODEC;
  });

  test('defaults to a devalue JSON block', () => {
    const html = renderIslandPropsScript('mochi-props-0', '{"a":1}', 1);
    expect(html).toContain('type="application/json"');
    expect(html).not.toContain('x-mochi-msgpack');
  });

  test('emits a msgpack block when MOCHI_ISLAND_CODEC=msgpack', () => {
    process.env.MOCHI_ISLAND_CODEC = 'msgpack';
    const html = renderIslandPropsScript('mochi-props-0', encode({ a: 1 }), 2);
    expect(html).toContain('type="application/x-mochi-msgpack"');
    expect(html).toContain('data-enc="base64"');
    expect(html).toContain('data-shared'); // emitCount >= 2
    expect(html).toContain('id="mochi-props-0"');
  });
});
