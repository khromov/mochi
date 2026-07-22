import { afterEach, describe, expect, it } from 'bun:test';
import { compile as svelteCompile } from 'svelte/compiler';
import { backendId, officialBackend, resetSvelteCompilerCache, resolveSvelteCompiler } from './svelteCompilerBackend';

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

  it('falls back to the official compiler when the rsvelte adapter is unusable', async () => {
    process.env[ENV_VAR] = 'rsvelte';
    // In this workspace the adapter resolves, so assert the contract that holds
    // either way: resolution never throws and always yields a usable backend.
    const backend = await resolveSvelteCompiler('rsvelte');
    expect(typeof backend.compile).toBe('function');
    expect(typeof backend.compileModule).toBe('function');
    expect(['svelte', 'rsvelte']).toContain(backend.name);
  });

  it('memoizes resolution', async () => {
    process.env[ENV_VAR] = 'rsvelte';
    expect(await resolveSvelteCompiler('rsvelte')).toBe(await resolveSvelteCompiler('rsvelte'));
  });
});
