import { describe, expect, mock, spyOn, test } from 'bun:test';
import { logger } from '../utils/log';

// The add-on isn't installed, so the loader hands back null after warning once.
// Per-file process isolation keeps this module mock from leaking into other tests.
mock.module('./svelteShaker', () => ({
  resolveSvelteShaker: async () => null,
}));

const { ComponentRegistry } = await import('./ComponentRegistry');

function shakenSources(registry: InstanceType<typeof ComponentRegistry>): Map<string, string> {
  return (registry as unknown as { shakenSources: Map<string, string> }).shakenSources;
}

describe('ComponentRegistry.prepareShake (add-on not installed)', () => {
  test('skips shaking quietly — the loader owns the one warning', async () => {
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    const error = spyOn(logger, 'error').mockImplementation(() => {});
    const info = spyOn(logger, 'info').mockImplementation(() => {});
    const registry = new ComponentRegistry({ development: false, optimize: true });

    await registry.prepareShake(process.cwd());

    expect(shakenSources(registry).size).toBe(0);
    // A missing package is a config problem, not an engine bug: none of the failure-path noise applies.
    expect(warn.mock.calls.some((c) => String(c[0]).includes('skipped'))).toBe(false);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('baseballyama'))).toBe(false);
    expect(error).not.toHaveBeenCalled();
    expect(info.mock.calls.some((c) => String(c[0]).includes('slimmed'))).toBe(false);

    warn.mockRestore();
    error.mockRestore();
    info.mockRestore();
  });
});
