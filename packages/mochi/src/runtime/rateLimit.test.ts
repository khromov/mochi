import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createRouteLimiter, sqliteStore, applyRateLimitHeaders } from './rateLimit';
import type { HitLimitStore } from '@joint-ops/hitlimit-bun';

const makeRequest = (url = 'http://localhost/x', headers?: Record<string, string>) => new Request(url, { headers });
const clientAddress = (address: string | null) => () => address;

describe('createRouteLimiter', () => {
  test('allows up to the limit, then blocks with headers/body/retryAfter', async () => {
    const limiter = createRouteLimiter({ limit: 2, window: '1m' });
    const first = await limiter.check(makeRequest(), clientAddress('1.2.3.4'));
    expect(first.kind).toBe('allowed');
    if (first.kind !== 'allowed') {
      throw new Error('unreachable');
    }
    expect(first.info.limit).toBe(2);
    expect(first.info.remaining).toBe(1);
    expect(first.headers['RateLimit-Remaining']).toBe('1');
    expect(first.headers['X-RateLimit-Limit']).toBe('2');

    await limiter.check(makeRequest(), clientAddress('1.2.3.4'));
    const third = await limiter.check(makeRequest(), clientAddress('1.2.3.4'));
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
    const outcome = await limiter.check(makeRequest(), clientAddress('1.2.3.4'));
    if (outcome.kind !== 'allowed') {
      throw new Error('expected allowed');
    }
    expect(outcome.info.limit).toBe(100);
    expect(outcome.info.remaining).toBe(99);
    expect(outcome.info.resetIn).toBeLessThanOrEqual(60);
  });

  test('window accepts milliseconds and unit strings; invalid throws', async () => {
    const millisecondWindowLimiter = createRouteLimiter({ limit: 1, window: 30_000 });
    const outcome = await millisecondWindowLimiter.check(makeRequest(), clientAddress('a'));
    if (outcome.kind !== 'allowed') {
      throw new Error('expected allowed');
    }
    expect(outcome.info.resetIn).toBeLessThanOrEqual(30);
    expect(() => createRouteLimiter({ window: 'nope' })).toThrow('Invalid window format');
    expect(() => createRouteLimiter({ window: '5x' })).toThrow('Invalid window format');
  });

  test('default key is the caller-provided client address', async () => {
    const limiter = createRouteLimiter({ limit: 1 });
    const outcome = await limiter.check(makeRequest(), clientAddress('203.0.113.9'));
    if (outcome.kind !== 'allowed') {
      throw new Error('expected allowed');
    }
    expect(outcome.info.key).toBe('203.0.113.9');
    // A different address gets its own bucket.
    const otherAddressOutcome = await limiter.check(makeRequest(), clientAddress('203.0.113.10'));
    expect(otherAddressOutcome.kind).toBe('allowed');
    // Null address falls back to 'unknown'.
    const anonymousOutcome = await limiter.check(makeRequest(), clientAddress(null));
    if (anonymousOutcome.kind !== 'allowed') {
      throw new Error('expected allowed');
    }
    expect(anonymousOutcome.info.key).toBe('unknown');
  });

  test('custom key generator isolates callers and ignores the address', async () => {
    const limiter = createRouteLimiter({ limit: 1, key: (request) => request.headers.get('x-user') ?? 'anon' });
    const firstRequestUserA = await limiter.check(makeRequest('http://localhost/x', { 'x-user': 'a' }), clientAddress('same-ip'));
    expect(firstRequestUserA.kind).toBe('allowed');
    const secondRequestUserA = await limiter.check(makeRequest('http://localhost/x', { 'x-user': 'a' }), clientAddress('same-ip'));
    expect(secondRequestUserA.kind).toBe('blocked');
    const firstRequestUserB = await limiter.check(makeRequest('http://localhost/x', { 'x-user': 'b' }), clientAddress('same-ip'));
    expect(firstRequestUserB.kind).toBe('allowed');
  });

  test('skip() bypasses without consuming quota', async () => {
    const limiter = createRouteLimiter({ limit: 1, skip: (request) => new URL(request.url).pathname === '/health' });
    expect((await limiter.check(makeRequest('http://localhost/health'), clientAddress('ip'))).kind).toBe('skip');
    expect((await limiter.check(makeRequest('http://localhost/health'), clientAddress('ip'))).kind).toBe('skip');
    expect((await limiter.check(makeRequest('http://localhost/other'), clientAddress('ip'))).kind).toBe('allowed');
  });

  test('onStoreError: default allows, deny blocks without limit info', async () => {
    const brokenStore: HitLimitStore = {
      hit: () => {
        throw new Error('store down');
      },
      reset: () => {},
    };
    const failOpenLimiter = createRouteLimiter({ store: brokenStore });
    expect((await failOpenLimiter.check(makeRequest(), clientAddress('ip'))).kind).toBe('skip');

    const failClosedLimiter = createRouteLimiter({ store: brokenStore, onStoreError: () => 'deny' });
    const outcome = await failClosedLimiter.check(makeRequest(), clientAddress('ip'));
    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') {
      throw new Error('unreachable');
    }
    expect(outcome.info).toBeNull();
    expect(outcome.retryAfterSeconds).toBeNull();
  });

  test('a shared store instance shares counters across limiters; ownsStore is false', async () => {
    const storeOwner = createRouteLimiter({ limit: 5 });
    const limiterA = createRouteLimiter({ limit: 2, store: storeOwner.store });
    const limiterB = createRouteLimiter({ limit: 2, store: storeOwner.store });
    expect(limiterA.ownsStore).toBe(false);
    expect(storeOwner.ownsStore).toBe(true);
    expect((await limiterA.check(makeRequest(), clientAddress('ip'))).kind).toBe('allowed');
    expect((await limiterB.check(makeRequest(), clientAddress('ip'))).kind).toBe('allowed');
    expect((await limiterA.check(makeRequest(), clientAddress('ip'))).kind).toBe('blocked');
  });

  test('custom response formatter shapes the blocked body', async () => {
    const limiter = createRouteLimiter({ limit: 1, response: (info) => ({ error: 'RATE_LIMITED', wait: info.resetIn }) });
    await limiter.check(makeRequest(), clientAddress('ip'));
    const blockedOutcome = await limiter.check(makeRequest(), clientAddress('ip'));
    if (blockedOutcome.kind !== 'blocked') {
      throw new Error('expected blocked');
    }
    expect(blockedOutcome.body.error).toBe('RATE_LIMITED');
    expect(typeof blockedOutcome.body.wait).toBe('number');
  });

  test('reset() clears a key', async () => {
    const limiter = createRouteLimiter({ limit: 1 });
    await limiter.check(makeRequest(), clientAddress('ip'));
    expect((await limiter.check(makeRequest(), clientAddress('ip'))).kind).toBe('blocked');
    await limiter.reset('ip');
    expect((await limiter.check(makeRequest(), clientAddress('ip'))).kind).toBe('allowed');
  });
});

describe('sqliteStore persistence', () => {
  // outDir must live under the package tree (see CLAUDE.md) — but sqlite dbs
  // just need a writable path, which mkdtemp under the package also gives us.
  const tempDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-ratelimit-sqlite-'));
  const dbPath = path.join(tempDir, 'ratelimit.db');

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('counters survive limiter recreation on the same db file', async () => {
    const firstLimiter = createRouteLimiter({ limit: 2, window: '1m', store: sqliteStore({ path: dbPath }) });
    await firstLimiter.check(makeRequest(), clientAddress('9.9.9.9'));
    await firstLimiter.check(makeRequest(), clientAddress('9.9.9.9'));
    expect((await firstLimiter.check(makeRequest(), clientAddress('9.9.9.9'))).kind).toBe('blocked');
    await firstLimiter.store.shutdown?.();

    const secondLimiter = createRouteLimiter({ limit: 2, window: '1m', store: sqliteStore({ path: dbPath }) });
    expect((await secondLimiter.check(makeRequest(), clientAddress('9.9.9.9'))).kind).toBe('blocked');
    await secondLimiter.store.shutdown?.();
  });
});

describe('applyRateLimitHeaders', () => {
  test('sets headers on a mutable response', () => {
    const response = applyRateLimitHeaders(new Response('ok'), { 'RateLimit-Limit': '5' });
    expect(response.headers.get('RateLimit-Limit')).toBe('5');
  });
});
