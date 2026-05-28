import { describe, expect, test } from 'bun:test';
import { resolveWarmupEnabled } from './warmup';

describe('resolveWarmupEnabled', () => {
  test('undefined is disabled in both modes', () => {
    expect(resolveWarmupEnabled(undefined, true)).toBe(false);
    expect(resolveWarmupEnabled(undefined, false)).toBe(false);
  });

  test('false is disabled in both modes', () => {
    expect(resolveWarmupEnabled(false, true)).toBe(false);
    expect(resolveWarmupEnabled(false, false)).toBe(false);
  });

  test('true warms in production only', () => {
    expect(resolveWarmupEnabled(true, false)).toBe(true); // prod
    expect(resolveWarmupEnabled(true, true)).toBe(false); // dev
  });

  test('object form selects the per-mode flag', () => {
    const opts = { enabledInProd: true, enabledInDev: false };
    expect(resolveWarmupEnabled(opts, false)).toBe(true); // prod → enabledInProd
    expect(resolveWarmupEnabled(opts, true)).toBe(false); // dev → enabledInDev
  });

  test('object form can enable dev and disable prod', () => {
    const opts = { enabledInProd: false, enabledInDev: true };
    expect(resolveWarmupEnabled(opts, true)).toBe(true);
    expect(resolveWarmupEnabled(opts, false)).toBe(false);
  });
});
