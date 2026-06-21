import { describe, expect, test } from 'bun:test';
import { packServerIslandProps, unpackServerIslandProps } from './serverIslandSerialize';

// Server-island props swapped from devalue to msgpackr; these assert the codec
// keeps devalue's documented type support (the parity validated in REPORT.md).
// The one known divergence is -0 (msgpackr restores +0), covered explicitly.
const rt = <T>(v: T): T => unpackServerIslandProps(packServerIslandProps(v)) as T;

describe('serverIslandSerialize — devalue type parity', () => {
  test('cyclical references', () => {
    const node: Record<string, unknown> = { id: 1 };
    node.self = node;
    const out = rt(node);
    expect(out.self).toBe(out);
  });

  test('repeated references keep shared identity', () => {
    const shared = { x: 1 };
    const out = rt([shared, shared]);
    expect(out[0]).toBe(out[1]);
  });

  test('undefined / Infinity / NaN', () => {
    const out = rt({ a: undefined, b: 1, pos: Infinity, neg: -Infinity, nan: NaN });
    expect('a' in out).toBe(true);
    expect(out.a).toBeUndefined();
    expect(out.pos).toBe(Infinity);
    expect(out.neg).toBe(-Infinity);
    expect(Number.isNaN(out.nan)).toBe(true);
  });

  test('RegExp', () => {
    const out = rt(/ab+c/gi);
    expect(out).toBeInstanceOf(RegExp);
    expect(out.source).toBe('ab+c');
    expect(out.flags).toBe('gi');
  });

  test('Date', () => {
    const d = new Date('2026-06-21T12:00:00.000Z');
    expect(rt(d).getTime()).toBe(d.getTime());
  });

  test('Map and Set', () => {
    const m = rt(
      new Map<unknown, unknown>([
        ['k', 1],
        [2, 'v'],
      ]),
    );
    expect(m).toBeInstanceOf(Map);
    expect(m.get('k')).toBe(1);
    expect(m.get(2)).toBe('v');
    const s = rt(new Set([1, 2, 3]));
    expect(s).toBeInstanceOf(Set);
    expect(s.has(2)).toBe(true);
  });

  test('BigInt', () => {
    expect(rt(123456789012345678901234567890n)).toBe(123456789012345678901234567890n);
  });

  test('ArrayBuffer and typed arrays', () => {
    const buf = rt(new Uint8Array([1, 2, 3, 4]).buffer);
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(buf)[0]).toBe(1);
    expect(rt(new Float64Array([1.5, 2.5]))[1]).toBe(2.5);
    expect(rt(new Int16Array([-1, 2]))[0]).toBe(-1);
  });

  test('URL and URLSearchParams (custom extensions)', () => {
    const u = rt(new URL('https://x.com/a?b=1#h'));
    expect(u).toBeInstanceOf(URL);
    expect(u.href).toBe('https://x.com/a?b=1#h');
    const q = rt(new URLSearchParams('a=1&b=2'));
    expect(q).toBeInstanceOf(URLSearchParams);
    expect(q.get('a')).toBe('1');
  });

  test('nested mix round-trips with types intact', () => {
    const out = rt({ d: new Date(0), m: new Map([['a', new Set([1])]]), url: new URL('https://y.com'), arr: [1, 'x', true, null] });
    expect(out.d).toBeInstanceOf(Date);
    expect((out.m.get('a') as Set<number>).has(1)).toBe(true);
    expect(out.url).toBeInstanceOf(URL);
    expect(out.arr[3]).toBeNull();
  });

  test('known divergence: -0 restores as +0 (documented)', () => {
    expect(Object.is(rt(-0), -0)).toBe(false);
    expect(rt(-0)).toBe(0);
  });
});
