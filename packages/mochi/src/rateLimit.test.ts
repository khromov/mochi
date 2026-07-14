import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createRouteLimiter, sqliteStore, applyRateLimitHeaders } from './rateLimit';
import type { HitLimitStore } from '@joint-ops/hitlimit-bun';

const req = (url = 'http://localhost/x', headers?: Record<string, string>) => new Request(url, { headers });
const addr = (ip: string | null) => () => ip;

describe('createRouteLimiter', () => {
  test('allows up to the limit, then blocks with headers/body/retryAfter', async () => {
    const limiter = createRouteLimiter({ limit: 2, window: '1m' });
    const first = await limiter.check(req(), addr('1.2.3.4'));
    expect(first.kind).toBe('allowed');
    if (first.kind !== 'allowed') {
      throw new Error('unreachable');
    }
    expect(first.info.limit).toBe(2);
    expect(first.info.remaining).toBe(1);
    expect(first.headers['RateLimit-Remaining']).toBe('1');
    expect(first.headers['X-RateLimit-Limit']).toBe('2');

    await limiter.check(req(), addr('1.2.3.4'));
    const third = await limiter.check(req(), addr('1.2.3.4'));
    expect(third.kind).toBe('blocked');
    if (third.kind !== 'blocked') {
      throw new Error('unreachable');
    }
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    expect(third.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(third.headers['Retry-After']).toBeDefined();
    expect(third.headers['RateLimit-Remaining']).toBe('0');
    expect(third.body.hitlimit).toBe(true);
    expect(third.body.remaining).toBe(0);
  });

  test('defaults: limit 100 / window 1m', async () => {
    const limiter = createRouteLimiter({});
    const outcome = await limiter.check(req(), addr('1.2.3.4'));
    if (outcome.kind !== 'allowed') {
      throw new Error('expected allowed');
    }
    expect(outcome.info.limit).toBe(100);
    expect(outcome.info.remaining).toBe(99);
    expect(outcome.info.resetIn).toBeLessThanOrEqual(60);
  });

  test('window accepts milliseconds and unit strings; invalid throws', async () => {
    const ms = createRouteLimiter({ limit: 1, window: 30_000 });
    const outcome = await ms.check(req(), addr('a'));
    if (outcome.kind !== 'allowed') {
      throw new Error('expected allowed');
    }
    expect(outcome.info.resetIn).toBeLessThanOrEqual(30);
    expect(() => createRouteLimiter({ window: 'nope' })).toThrow('Invalid window format');
    expect(() => createRouteLimiter({ window: '5x' })).toThrow('Invalid window format');
  });

  test('default key is the caller-provided client address', async () => {
    const limiter = createRouteLimiter({ limit: 1 });
    const outcome = await limiter.check(req(), addr('203.0.113.9'));
    if (outcome.kind !== 'allowed') {
      throw new Error('expected allowed');
    }
    expect(outcome.info.key).toBe('203.0.113.9');
    // A different address gets its own bucket.
    const other = await limiter.check(req(), addr('203.0.113.10'));
    expect(other.kind).toBe('allowed');
    // Null address falls back to 'unknown'.
    const anon = await limiter.check(req(), addr(null));
    if (anon.kind !== 'allowed') {
      throw new Error('expected allowed');
    }
    expect(anon.info.key).toBe('unknown');
  });

  test('custom key generator isolates callers and ignores the address', async () => {
    const limiter = createRouteLimiter({ limit: 1, key: (r) => r.headers.get('x-user') ?? 'anon' });
    const a1 = await limiter.check(req('http://localhost/x', { 'x-user': 'a' }), addr('same-ip'));
    expect(a1.kind).toBe('allowed');
    const a2 = await limiter.check(req('http://localhost/x', { 'x-user': 'a' }), addr('same-ip'));
    expect(a2.kind).toBe('blocked');
    const b1 = await limiter.check(req('http://localhost/x', { 'x-user': 'b' }), addr('same-ip'));
    expect(b1.kind).toBe('allowed');
  });

  test('skip() bypasses without consuming quota', async () => {
    const limiter = createRouteLimiter({ limit: 1, skip: (r) => new URL(r.url).pathname === '/health' });
    expect((await limiter.check(req('http://localhost/health'), addr('ip'))).kind).toBe('skip');
    expect((await limiter.check(req('http://localhost/health'), addr('ip'))).kind).toBe('skip');
    expect((await limiter.check(req('http://localhost/other'), addr('ip'))).kind).toBe('allowed');
  });

  test('onStoreError: default allows, deny blocks without limit info', async () => {
    const broken: HitLimitStore = {
      hit: () => {
        throw new Error('store down');
      },
      reset: () => {},
    };
    const failOpen = createRouteLimiter({ store: broken });
    expect((await failOpen.check(req(), addr('ip'))).kind).toBe('skip');

    const failClosed = createRouteLimiter({ store: broken, onStoreError: () => 'deny' });
    const outcome = await failClosed.check(req(), addr('ip'));
    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') {
      throw new Error('unreachable');
    }
    expect(outcome.info).toBeNull();
    expect(outcome.retryAfterSeconds).toBeNull();
  });

  test('a shared store instance shares counters across limiters; ownsStore is false', async () => {
    const shared = createRouteLimiter({ limit: 5 });
    const a = createRouteLimiter({ limit: 2, store: shared.store });
    const b = createRouteLimiter({ limit: 2, store: shared.store });
    expect(a.ownsStore).toBe(false);
    expect(shared.ownsStore).toBe(true);
    expect((await a.check(req(), addr('ip'))).kind).toBe('allowed');
    expect((await b.check(req(), addr('ip'))).kind).toBe('allowed');
    expect((await a.check(req(), addr('ip'))).kind).toBe('blocked');
  });

  test('custom response formatter shapes the blocked body', async () => {
    const limiter = createRouteLimiter({ limit: 1, response: (info) => ({ error: 'RATE_LIMITED', wait: info.resetIn }) });
    await limiter.check(req(), addr('ip'));
    const blocked = await limiter.check(req(), addr('ip'));
    if (blocked.kind !== 'blocked') {
      throw new Error('expected blocked');
    }
    expect(blocked.body.error).toBe('RATE_LIMITED');
    expect(typeof blocked.body.wait).toBe('number');
  });

  test('reset() clears a key', async () => {
    const limiter = createRouteLimiter({ limit: 1 });
    await limiter.check(req(), addr('ip'));
    expect((await limiter.check(req(), addr('ip'))).kind).toBe('blocked');
    await limiter.reset('ip');
    expect((await limiter.check(req(), addr('ip'))).kind).toBe('allowed');
  });
});

describe('sqliteStore persistence', () => {
  // outDir must live under the package tree (see CLAUDE.md) — but sqlite dbs
  // just need a writable path, which mkdtemp under the package also gives us.
  const dir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-ratelimit-sqlite-'));
  const dbPath = path.join(dir, 'ratelimit.db');

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('counters survive limiter recreation on the same db file', async () => {
    const first = createRouteLimiter({ limit: 2, window: '1m', store: sqliteStore({ path: dbPath }) });
    await first.check(req(), addr('9.9.9.9'));
    await first.check(req(), addr('9.9.9.9'));
    expect((await first.check(req(), addr('9.9.9.9'))).kind).toBe('blocked');
    await first.store.shutdown?.();

    const second = createRouteLimiter({ limit: 2, window: '1m', store: sqliteStore({ path: dbPath }) });
    expect((await second.check(req(), addr('9.9.9.9'))).kind).toBe('blocked');
    await second.store.shutdown?.();
  });
});

describe('applyRateLimitHeaders', () => {
  test('sets headers on a mutable response', () => {
    const res = applyRateLimitHeaders(new Response('ok'), { 'RateLimit-Limit': '5' });
    expect(res.headers.get('RateLimit-Limit')).toBe('5');
  });
});
