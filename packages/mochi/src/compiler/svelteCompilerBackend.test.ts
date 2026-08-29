import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { compile as svelteCompile } from 'svelte/compiler';
import { logger } from '../utils/log';
import { backendId, isBackend, loadRsvelte, officialBackend, resetSvelteCompilerCache, resolveSvelteCompiler, rsvelteFallbackAdvice } from './svelteCompilerBackend';

const ENV_VAR = 'MOCHI_SVELTE_COMPILER';
const original = process.env[ENV_VAR];

afterEach(() => {
  if (original === undefined) {
    delete process.env[ENV_VAR];
  } else {
    process.env[ENV_VAR] = original;
  }
  resetSvelteCompilerCache();
});

describe('officialBackend', () => {
  it('compiles through svelte/compiler', () => {
    const source = `<script>let n = $state(0);</script><p>{n}</p>`;
    const opts = { generate: 'server' as const, filename: 'A.svelte', discloseVersion: false };
    expect(officialBackend.compile(source, opts).js.code).toBe(svelteCompile(source, opts).js.code);
  });

  it('reports a version for the cache fingerprint', () => {
    expect(backendId(officialBackend)).toMatch(/^svelte@\d+\.\d+\.\d+/);
  });
});

describe('resolveSvelteCompiler', () => {
  it('defaults to the official compiler', async () => {
    delete process.env[ENV_VAR];
    expect(await resolveSvelteCompiler()).toBe(officialBackend);
    expect(await resolveSvelteCompiler('svelte')).toBe(officialBackend);
  });

  it('lets the env var override the configured choice', async () => {
    process.env[ENV_VAR] = 'svelte';
    // 'rsvelte' is configured, but the env var forces the official compiler —
    // no dynamic import is attempted at all.
    expect(await resolveSvelteCompiler('rsvelte')).toBe(officialBackend);
  });

  it('ignores an unrecognised env value and keeps the configured choice', async () => {
    process.env[ENV_VAR] = 'nonsense';
    expect(await resolveSvelteCompiler('svelte')).toBe(officialBackend);
  });

  it('memoizes resolution', async () => {
    // Break the real adapter import so every underlying load is observable as one warn — a
    // second warn would mean the second call re-ran loadRsvelte instead of hitting the cache.
    mock.module('@mochi-framework/rsvelte', () => {
      throw new Error('unavailable in this test');
    });
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      process.env[ENV_VAR] = 'rsvelte';
      const first = await resolveSvelteCompiler('rsvelte');
      expect(first).toBe(officialBackend);
      expect(await resolveSvelteCompiler('rsvelte')).toBe(first);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

// The adapter resolves in this workspace, so the failure modes users actually
// hit — package absent, package broken — are driven through the injected loader.
describe('loadRsvelte fallback', () => {
  it('falls back when the adapter cannot be imported', async () => {
    const backend = await loadRsvelte(() => Promise.reject(new Error(`Cannot find module '@mochi-framework/rsvelte'`)));
    expect(backend).toBe(officialBackend);
  });

  it('falls back when a non-Error rejection escapes the import', async () => {
    expect(await loadRsvelte(() => Promise.reject('boom'))).toBe(officialBackend);
  });

  it('falls back when the module has no usable export', async () => {
    expect(await loadRsvelte(async () => ({}))).toBe(officialBackend);
    expect(await loadRsvelte(async () => null)).toBe(officialBackend);
    expect(await loadRsvelte(async () => ({ svelteCompilerBackend: { name: 'rsvelte', version: '1.0.0' } }))).toBe(officialBackend);
    expect(await loadRsvelte(async () => ({ svelteCompilerBackend: { compile() {}, compileModule() {}, name: 'rsvelte' } }))).toBe(officialBackend);
  });

  it('accepts a conforming backend', async () => {
    const fake = { name: 'rsvelte', version: '0.2.8+svelte5.56.4', compile: () => ({ js: { code: '' } }), compileModule: () => ({ js: { code: '' } }) };
    expect(await loadRsvelte(async () => ({ svelteCompilerBackend: fake }))).toBe(fake);
    expect(backendId(fake)).toBe('rsvelte@0.2.8+svelte5.56.4');
  });
});

describe('rsvelteFallbackAdvice', () => {
  const withPlatform = <T>(platform: string, fn: () => T): T => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { ...descriptor, value: platform });
    try {
      return fn();
    } finally {
      Object.defineProperty(process, 'platform', descriptor);
    }
  };

  it('advises installing the adapter when it simply is not there', () => {
    expect(rsvelteFallbackAdvice(`Cannot find module '@mochi-framework/rsvelte'`)).toContain('bun add -d @mochi-framework/rsvelte');
  });

  // The binding's own loader blames a skipped optional dependency for what is really a missing
  // C runtime, so an install suggestion here sends people hunting for a phantom install problem.
  it('advises the VC++ redistributable for a Windows binding-load failure', () => {
    const advice = withPlatform('win32', () => rsvelteFallbackAdvice('LoadLibrary failed: The specified module could not be found.'));
    expect(advice).toContain('Microsoft.VCRedist.2015+.x64');
    expect(advice).not.toContain('bun add');
  });

  it('stays quiet when the adapter already explained the cause', () => {
    expect(withPlatform('win32', () => rsvelteFallbackAdvice('… winget install --id Microsoft.VCRedist.2015+.x64 -e … LoadLibrary failed'))).toBe('');
  });

  it('does not blame the redistributable off Windows', () => {
    expect(withPlatform('linux', () => rsvelteFallbackAdvice('LoadLibrary failed'))).toContain('bun add -d');
  });
});

describe('isBackend', () => {
  const ok = { name: 'x', version: '1', compile: () => ({ js: { code: '' } }), compileModule: () => ({ js: { code: '' } }) };

  it('accepts a full backend and rejects partial ones', () => {
    expect(isBackend(ok)).toBe(true);
    expect(isBackend(undefined)).toBe(false);
    expect(isBackend(null)).toBe(false);
    expect(isBackend('rsvelte')).toBe(false);
    expect(isBackend({ ...ok, compile: 'nope' })).toBe(false);
    expect(isBackend({ ...ok, compileModule: undefined })).toBe(false);
    expect(isBackend({ ...ok, name: 1 })).toBe(false);
    expect(isBackend({ ...ok, version: undefined })).toBe(false);
  });
});
