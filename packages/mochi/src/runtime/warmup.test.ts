import { describe, expect, test } from 'bun:test';
import { resolveWarmupEnabled, markWarmupRequest, isWarmupRequest, isWarmablePattern } from './warmup';

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

describe('warmup request tagging', () => {
  test('marked request is recognised as warmup', () => {
    const req = new Request('http://localhost/');
    expect(markWarmupRequest(req)).toBe(req);
    expect(isWarmupRequest(req)).toBe(true);
  });

  test('an unmarked request is never warmup, even if it sets the old header', () => {
    const real = new Request('http://localhost/', { headers: { 'x-mochi-warmup': '1' } });
    expect(isWarmupRequest(real)).toBe(false);
  });

  test('tagging is per-object — a different request is not warmup', () => {
    const warmed = markWarmupRequest(new Request('http://localhost/a'));
    const other = new Request('http://localhost/a');
    expect(isWarmupRequest(warmed)).toBe(true);
    expect(isWarmupRequest(other)).toBe(false);
  });
});

describe('isWarmablePattern', () => {
  test('static patterns are warmable', () => {
    expect(isWarmablePattern('/')).toBe(true);
    expect(isWarmablePattern('/about')).toBe(true);
    expect(isWarmablePattern('/docs/intro')).toBe(true);
    expect(isWarmablePattern('/sitemap.xml')).toBe(true);
  });

  test('parameterized patterns are skipped', () => {
    expect(isWarmablePattern('/docs/:slug')).toBe(false);
    expect(isWarmablePattern('/users/:id/posts')).toBe(false);
  });

  test('wildcard catch-all patterns are skipped', () => {
    expect(isWarmablePattern('/*')).toBe(false);
    expect(isWarmablePattern('/assets/*')).toBe(false);
  });
});
