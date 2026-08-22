import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { MochiCookieJar } from './cookies';

const RUNS = { numRuns: 2000 };

// Cookie names/values restricted to a safe token alphabet — `set()` delegates to
// Bun.Cookie, which rejects control chars / separators. We're fuzzing the jar's
// bookkeeping, not Bun's cookie-syntax validation.
const token = fc.array(fc.constantFrom(...'abcdefghijABCDEFGHIJ0123456789_'.split('')), { minLength: 1, maxLength: 24 }).map((chars) => chars.join(''));

describe('MochiCookieJar — property-based fuzzing', () => {
  test('constructing from an arbitrary Cookie header never throws; peekAll is always an array', () => {
    fc.assert(
      fc.property(fc.string(), (header) => {
        let jar: MochiCookieJar | undefined;
        expect(() => {
          jar = new MochiCookieJar(header);
        }).not.toThrow();
        expect(Array.isArray(jar!.peekAll())).toBe(true);
      }),
      RUNS,
    );
  });

  test('set(name, value) then get(name) returns the value', () => {
    fc.assert(
      fc.property(token, token, (name, value) => {
        const jar = new MochiCookieJar(null);
        jar.set(name, value);
        expect(jar.get(name)).toBe(value);
      }),
      RUNS,
    );
  });

  test('getAll recovers every uniquely-named cookie that was set', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.tuple(token, token), { selector: (pair) => pair[0] }), (pairs) => {
        const jar = new MochiCookieJar(null);
        for (const [name, value] of pairs) {
          jar.set(name, value);
        }
        const all = jar.getAll();
        expect(all.length).toBe(pairs.length);
        for (const [name, value] of pairs) {
          expect(all.find((c) => c.name === name)?.value).toBe(value);
        }
      }),
      RUNS,
    );
  });

  test('peekAll never flips the accessed flag; get always does', () => {
    fc.assert(
      fc.property(fc.string(), (header) => {
        const jar = new MochiCookieJar(header);
        jar.peekAll();
        expect(jar.wasAccessed()).toBe(false);
        jar.get('anything');
        expect(jar.wasAccessed()).toBe(true);
      }),
      RUNS,
    );
  });
});
