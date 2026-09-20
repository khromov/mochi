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
 * `URLSearchParams` is the one type bun 1.4.2 gets wrong here: two with identical serializations compare unequal
 * both on their own and as an object property (inside a `Map` they happen to compare fine), and the upstream
 * fixtures round-trip them. So the fallback below is reached only for a tree that holds one, leaving every other
 * comparison on bun's own strict equality.
 */
function hasSearchParams(value: any, seen: Set<any> = new Set()): boolean {
  if (value instanceof URLSearchParams) {
    return true;
  }
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return false;
  }
  seen.add(value);
  if (value instanceof Map) {
    return [...value].some(([k, v]) => hasSearchParams(k, seen) || hasSearchParams(v, seen));
  }
  if (value instanceof Set) {
    return [...value].some((v) => hasSearchParams(v, seen));
  }
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
    return false;
  }
  return Object.values(value).some((v) => hasSearchParams(v, seen));
}

function strictlyEqual(actual: any, expected: any): boolean {
  try {
    expect(actual).toStrictEqual(expected);
    return true;
  } catch {
    return false;
  }
}

/** Structural comparison that accepts two identically-serializing `URLSearchParams` at any depth and hands every other leaf back to bun. */
function equalWithSearchParams(actual: any, expected: any, seen: Set<any> = new Set()): boolean {
  if (actual instanceof URLSearchParams || expected instanceof URLSearchParams) {
    return actual instanceof URLSearchParams && expected instanceof URLSearchParams && String(actual) === String(expected);
  }
  if (actual === null || expected === null || typeof actual !== 'object' || typeof expected !== 'object' || seen.has(actual)) {
    return strictlyEqual(actual, expected);
  }
  if (Object.getPrototypeOf(actual) !== Object.getPrototypeOf(expected)) {
    return false;
  }
  seen.add(actual);
  if (actual instanceof Map || actual instanceof Set || (!Array.isArray(actual) && Object.getPrototypeOf(actual) !== Object.prototype && Object.getPrototypeOf(actual) !== null)) {
    return strictlyEqual(actual, expected);
  }
  const keys = Reflect.ownKeys(actual);
  return (
    keys.length === Reflect.ownKeys(expected).length &&
    keys.every((key) => Object.hasOwn(expected, key) && equalWithSearchParams((actual as any)[key], (expected as any)[key], seen))
  );
}

// `equal` maps to toStrictEqual, not toEqual: uvu's assert.equal is `dequal`, which compares prototypes and does
// not ignore undefined-valued properties. toEqual would silently accept both.
export const assert = {
  equal: (actual: any, expected: any, _msg?: string) => {
    if (hasSearchParams(actual) || hasSearchParams(expected)) {
      expect(equalWithSearchParams(actual, expected)).toBe(true);
      return;
    }
    expect(actual).toStrictEqual(expected);
  },
  is: (actual: any, expected: any, _msg?: string) => {
    // uvu's assert.is is `===`, while `toBe` is `Object.is` — they disagree on exactly the two values these suites
    // care about most, since Object.is separates 0 from -0 and equates NaN with NaN.
    if (actual !== expected) {
      expect(actual).toBe(expected);
      expect.unreachable('assert.is compares with ===, which NaN never satisfies');
    }
  },
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
