import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { isShakerBackend, loadSvelteShaker, resetSvelteShakerCache, resolveSvelteShaker, type SvelteShakerBackend } from './svelteShaker';
import { logger } from '../utils/log';

const fake: SvelteShakerBackend = {
  name: 'svelte-shaker',
  version: '0.18.1',
  shakeApp: async () => ({ shaken: new Map(), originals: new Map() }),
};

afterEach(() => {
  resetSvelteShakerCache();
});

// The add-on resolves in this workspace, so the failure modes users actually hit — package absent, package broken —
// are driven through the injected loader.
describe('loadSvelteShaker', () => {
  test('returns null and names the install command when the import rejects', async () => {
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});

    const backend = await loadSvelteShaker(() => Promise.reject(new Error("Cannot find module '@mochi-framework/svelte-shaker'")));

    expect(backend).toBeNull();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('bun add -d @mochi-framework/svelte-shaker'))).toBe(true);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('Cannot find module'))).toBe(true);
    warn.mockRestore();
  });

  test('tolerates a non-Error rejection', async () => {
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});

    expect(await loadSvelteShaker(() => Promise.reject('boom'))).toBeNull();

    expect(warn.mock.calls.some((c) => String(c[0]).includes('boom'))).toBe(true);
    warn.mockRestore();
  });

  test.each([
    ['no exports', {}],
    ['null module', null],
    ['missing shakeApp', { svelteShakerBackend: { name: 'svelte-shaker', version: '0.18.1' } }],
    ['missing version', { svelteShakerBackend: { name: 'svelte-shaker', shakeApp: () => {} } }],
    ['missing name', { svelteShakerBackend: { version: '0.18.1', shakeApp: () => {} } }],
  ])('returns null for a malformed module (%s)', async (_label, mod) => {
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});

    expect(await loadSvelteShaker(() => Promise.resolve(mod))).toBeNull();

    expect(warn.mock.calls.some((c) => String(c[0]).includes('did not export a usable'))).toBe(true);
    warn.mockRestore();
  });

  test('returns a conforming backend untouched', async () => {
    expect(await loadSvelteShaker(() => Promise.resolve({ svelteShakerBackend: fake }))).toBe(fake);
  });
});

describe('resolveSvelteShaker', () => {
  test('memoizes, so a missing add-on warns once however many registries resolve it', async () => {
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    const missing = () => Promise.reject(new Error('Cannot find module'));

    expect(await resolveSvelteShaker(missing)).toBeNull();
    expect(await resolveSvelteShaker(missing)).toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test('announces the resolved engine once', async () => {
    const info = spyOn(logger, 'info').mockImplementation(() => {});
    const present = () => Promise.resolve({ svelteShakerBackend: fake });

    expect(await resolveSvelteShaker(present)).toBe(fake);
    expect(await resolveSvelteShaker(present)).toBe(fake);

    expect(info.mock.calls.filter((c) => String(c[0]).includes('svelte-shaker@0.18.1'))).toHaveLength(1);
    info.mockRestore();
  });
});

describe('isShakerBackend', () => {
  test.each([
    [fake, true],
    [{ ...fake, shakeApp: 'nope' }, false],
    [{ name: 'x', version: '1' }, false],
    [{}, false],
    [null, false],
    [undefined, false],
    ['string', false],
  ])('%p -> %p', (value, expected) => {
    expect(isShakerBackend(value)).toBe(expected);
  });
});
