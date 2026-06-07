import { describe, expect, mock, spyOn, test } from 'bun:test';
import { logger } from './log';

// Force the engine wrapper to throw so we exercise prepareShake's catch branch.
// Per-file process isolation keeps this module mock from leaking into other tests.
mock.module('./svelteShaker', () => ({
  shakeApp: () => {
    throw new Error('boom');
  },
}));

const { ComponentRegistry } = await import('./ComponentRegistry');

function shakenSources(registry: InstanceType<typeof ComponentRegistry>): Map<string, string> {
  return (registry as unknown as { shakenSources: Map<string, string> }).shakenSources;
}

describe('ComponentRegistry.prepareShake (failure fallback)', () => {
  test('falls back to an empty cache and warns when the shake throws', async () => {
    const warn = spyOn(logger, 'warn');
    const registry = new ComponentRegistry({ development: false, optimize: true });
    // Pre-seed so we can prove the catch resets it rather than leaving stale source.
    shakenSources(registry).set('/stale.svelte', 'stale');

    // Resolves (does not throw) despite the engine error.
    await registry.prepareShake(process.cwd());

    expect(shakenSources(registry).size).toBe(0);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('skipped'))).toBe(true);
    warn.mockRestore();
  });
});
