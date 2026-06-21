import { test, expect } from 'bun:test';
import { isNativeAccelerationEnabled, pack, unpack } from 'msgpackr';

// This stub substitutes for the native `msgpackr-extract` accelerator two ways:
//   1. This workspace package is itself named `msgpackr-extract@3.0.4`, which
//      satisfies msgpackr's optional `^3.0.2` range, so Bun links it by name.
//   2. The root package.json `overrides` pins it regardless of version range
//      (future-proofs against a msgpackr bump that requires e.g. ^4.x).
// These tests assert the end state — native acceleration is off and msgpackr
// still works — not any single mechanism. They go red if the stub stops taking
// effect (e.g. it's deleted, or the real native package gets installed and
// flips `isNativeAccelerationEnabled` to true).

test('native acceleration is disabled by the msgpackr-extract stub', () => {
  expect(isNativeAccelerationEnabled).toBe(false);
});

test('msgpackr still roundtrips on the pure-JS fallback', () => {
  const obj = {
    hello: 'world',
    nums: [1, 2, 3],
    nested: { a: true, b: 'a longish string to exercise the string decoder path' },
  };
  expect(unpack(pack(obj))).toEqual(obj);
});
