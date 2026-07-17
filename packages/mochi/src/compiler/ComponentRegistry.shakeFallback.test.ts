import { describe, expect, mock, spyOn, test } from 'bun:test';
import { logger } from '../utils/log';

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
  test('falls back to an empty cache, warns, and surfaces the error for reporting', async () => {
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    const error = spyOn(logger, 'error').mockImplementation(() => {});
    const registry = new ComponentRegistry({ development: false, optimize: true });
    // Pre-seed so we can prove the catch resets it rather than leaving stale source.
    shakenSources(registry).set('/stale.svelte', 'stale');

    // Resolves (does not throw) despite the engine error.
    await registry.prepareShake(process.cwd());

    // Empty cache -> every onLoad reads the original on-disk source (unshaken).
    expect(shakenSources(registry).size).toBe(0);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('skipped'))).toBe(true);
    // The user is pointed at svelte-shaker's tracker so the bug can be reported,
    // and the underlying error itself is dumped so that report can be actionable.
    expect(warn.mock.calls.some((c) => String(c[0]).includes('github.com/baseballyama/svelte-shaker/issues'))).toBe(true);
    expect(error.mock.calls.some((c) => c[0] instanceof Error && c[0].message === 'boom')).toBe(true);

    warn.mockRestore();
    error.mockRestore();
  });
});
