import { describe, expect, test } from 'bun:test';
import { CompileCache, compileFingerprint, createCompileCacheStats, type CompiledFileOutput } from './compileCache';

const OUTPUT: CompiledFileOutput = { js: 'export default 1;', css: '.a{}', hydratables: [], serverIslands: [], scriptEntries: [], preprocessErrors: [] };
const FP = compileFingerprint({ runes: true }, true);

describe('compileCache', () => {
  test('miss then hit for the same source + fingerprint', () => {
    const cache = new CompileCache();
    const stats = createCompileCacheStats();
    expect(cache.get('server', '/A.svelte', 'src', FP, stats)).toBeUndefined();
    cache.set('server', '/A.svelte', 'src', FP, OUTPUT);
    expect(cache.get('server', '/A.svelte', 'src', FP, stats)).toBe(OUTPUT);
    expect(stats).toEqual({ hits: 1, misses: 1 });
  });

  test('source change invalidates the entry', () => {
    const cache = new CompileCache();
    cache.set('server', '/A.svelte', 'src', FP, OUTPUT);
    expect(cache.get('server', '/A.svelte', 'changed', FP)).toBeUndefined();
  });

  test('fingerprint change (compiler options / dev flag) invalidates the entry', () => {
    const cache = new CompileCache();
    cache.set('server', '/A.svelte', 'src', FP, OUTPUT);
    const otherOptions = compileFingerprint({ runes: false }, true);
    const otherDev = compileFingerprint({ runes: true }, false);
    expect(cache.get('server', '/A.svelte', 'src', otherOptions)).toBeUndefined();
    expect(cache.get('server', '/A.svelte', 'src', otherDev)).toBeUndefined();
  });

  test('compiler backend change invalidates the entry', () => {
    const cache = new CompileCache();
    cache.set('server', '/A.svelte', 'src', compileFingerprint({ runes: true }, true, 'svelte@5.56.7'), OUTPUT);
    expect(cache.get('server', '/A.svelte', 'src', compileFingerprint({ runes: true }, true, 'rsvelte@5.56.4'))).toBeUndefined();
    expect(cache.get('server', '/A.svelte', 'src', compileFingerprint({ runes: true }, true, 'svelte@5.56.7'))).toBe(OUTPUT);
  });

  test('server and client targets keep independent entries for the same path', () => {
    const cache = new CompileCache();
    const serverOut: CompiledFileOutput = { ...OUTPUT, js: 'server' };
    const clientOut: CompiledFileOutput = { ...OUTPUT, js: 'client' };
    cache.set('server', '/A.svelte', 'src', FP, serverOut);
    cache.set('client', '/A.svelte', 'src', FP, clientOut);
    expect(cache.get('server', '/A.svelte', 'src', FP)?.js).toBe('server');
    expect(cache.get('client', '/A.svelte', 'src', FP)?.js).toBe('client');
  });

  test('evict drops both target entries for a path', () => {
    const cache = new CompileCache();
    cache.set('server', '/A.svelte', 'src', FP, OUTPUT);
    cache.set('client', '/A.svelte', 'src', FP, OUTPUT);
    cache.evict('/A.svelte');
    expect(cache.get('server', '/A.svelte', 'src', FP)).toBeUndefined();
    expect(cache.get('client', '/A.svelte', 'src', FP)).toBeUndefined();
  });

  test('separate instances do not share entries (no cross-registry contamination)', () => {
    const a = new CompileCache();
    const b = new CompileCache();
    a.set('server', '/A.svelte', 'src', FP, OUTPUT);
    expect(b.get('server', '/A.svelte', 'src', FP)).toBeUndefined();
  });

  test('reset drops every entry', () => {
    const cache = new CompileCache();
    cache.set('server', '/A.svelte', 'src', FP, OUTPUT);
    cache.set('client', '/B.svelte', 'src', FP, OUTPUT);
    cache.reset();
    expect(cache.get('server', '/A.svelte', 'src', FP)).toBeUndefined();
    expect(cache.get('client', '/B.svelte', 'src', FP)).toBeUndefined();
  });
});
