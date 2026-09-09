// Maps uvu's suite/assert API onto bun:test so the upstream devalue suites port as a header swap rather than a
// rewrite, keeping them diffable against the fork. Test-only; excluded from the published package.
import { describe, expect, test as bunTest } from 'bun:test';

export type UvuTest = typeof bunTest & { run: () => void };

/** uvu's `suite(name)` returns a callable test registrar with a `.run()`; bun:test needs the body collected inside `describe`. */
export function suite(name: string): UvuTest {
  const queued: [string, () => void][] = [];
  const registrar = ((testName: string, fn: () => void) => {
    queued.push([testName, fn]);
  }) as unknown as UvuTest;
  registrar.run = () => {
    describe(name, () => {
      for (const [testName, fn] of queued) {
        bunTest(testName, fn);
      }
    });
  };
  return registrar;
}

/** uvu's default suite, used by the upstream files' top-level `uvu.test(...)` calls. */
export const test: UvuTest = suite('devalue');

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * `expect().toEqual()` reports two `URLSearchParams` with identical serializations as unequal (Bun 1.4.2), and the
 * upstream fixtures round-trip one. Comparing the serialization is also stricter than uvu's `dequal`, which sees no
 * own enumerable keys on either side and passes vacuously.
 */
function equalish(actual: any, expected: any): boolean | undefined {
  const isUsp = actual instanceof URLSearchParams && expected instanceof URLSearchParams;
  const isUrl = actual instanceof URL && expected instanceof URL;
  return isUsp || isUrl ? String(actual) === String(expected) : undefined;
}

export const assert = {
  equal: (actual: any, expected: any, _msg?: string) => {
    const special = equalish(actual, expected);
    if (special !== undefined) {
      expect(special).toBe(true);
      return;
    }
    expect(actual).toEqual(expected);
  },
  is: (actual: any, expected: any, _msg?: string) => expect(actual).toBe(expected),
  ok: (value: any, _msg?: string) => expect(value).toBeTruthy(),
  not: { ok: (value: any, _msg?: string) => expect(value).toBeFalsy() },
  type: (value: any, expected: string, _msg?: string) => expect(typeof value === expected).toBeTruthy(),
  instance: (value: any, ctor: any, _msg?: string) => expect(value).toBeInstanceOf(ctor),
  /** uvu accepts a predicate as the matcher, which `expect().toThrow()` does not, so this runs the call itself. */
  throws: (fn: () => unknown, matcher?: any, _msg?: string) => {
    if (typeof matcher !== 'function' || matcher.prototype instanceof Error || matcher === Error) {
      return matcher === undefined ? expect(fn).toThrow() : expect(fn).toThrow(matcher);
    }
    try {
      fn();
    } catch (err) {
      expect(matcher(err)).toBeTruthy();
      return;
    }
    expect.unreachable('expected the call to throw');
  },
  unreachable: (msg?: string) => expect.unreachable(msg),
};
