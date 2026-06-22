import { beforeEach, describe, expect, test } from 'bun:test';
import {
  __resetCompileMemCache,
  compileFingerprint,
  createCompileCacheStats,
  evictCompileCacheEntry,
  getCachedCompile,
  setCachedCompile,
  type CompiledFileOutput,
} from './compileCache';

const OUTPUT: CompiledFileOutput = { js: 'export default 1;', css: '.a{}', hydratables: [], serverIslands: [] };
const FP = compileFingerprint({ runes: true }, true);

beforeEach(() => {
  __resetCompileMemCache();
});

describe('compileCache', () => {
  test('miss then hit for the same source + fingerprint', () => {
    const stats = createCompileCacheStats();
    expect(getCachedCompile('server', '/A.svelte', 'src', FP, stats)).toBeUndefined();
    setCachedCompile('server', '/A.svelte', 'src', FP, OUTPUT);
    expect(getCachedCompile('server', '/A.svelte', 'src', FP, stats)).toBe(OUTPUT);
    expect(stats).toEqual({ hits: 1, misses: 1 });
  });

  test('source change invalidates the entry', () => {
    setCachedCompile('server', '/A.svelte', 'src', FP, OUTPUT);
    expect(getCachedCompile('server', '/A.svelte', 'changed', FP)).toBeUndefined();
  });

  test('fingerprint change (compiler options / dev flag) invalidates the entry', () => {
    setCachedCompile('server', '/A.svelte', 'src', FP, OUTPUT);
    const otherOptions = compileFingerprint({ runes: false }, true);
    const otherDev = compileFingerprint({ runes: true }, false);
    expect(getCachedCompile('server', '/A.svelte', 'src', otherOptions)).toBeUndefined();
    expect(getCachedCompile('server', '/A.svelte', 'src', otherDev)).toBeUndefined();
  });

  test('server and client targets keep independent entries for the same path', () => {
    const serverOut: CompiledFileOutput = { ...OUTPUT, js: 'server' };
    const clientOut: CompiledFileOutput = { ...OUTPUT, js: 'client' };
    setCachedCompile('server', '/A.svelte', 'src', FP, serverOut);
    setCachedCompile('client', '/A.svelte', 'src', FP, clientOut);
    expect(getCachedCompile('server', '/A.svelte', 'src', FP)?.js).toBe('server');
    expect(getCachedCompile('client', '/A.svelte', 'src', FP)?.js).toBe('client');
  });

  test('evict drops both target entries for a path', () => {
    setCachedCompile('server', '/A.svelte', 'src', FP, OUTPUT);
    setCachedCompile('client', '/A.svelte', 'src', FP, OUTPUT);
    evictCompileCacheEntry('/A.svelte');
    expect(getCachedCompile('server', '/A.svelte', 'src', FP)).toBeUndefined();
    expect(getCachedCompile('client', '/A.svelte', 'src', FP)).toBeUndefined();
  });
});
