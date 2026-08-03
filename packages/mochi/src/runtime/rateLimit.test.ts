import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { sqliteStore as hitlimitSqliteStore } from '@joint-ops/hitlimit-bun/stores/sqlite';
import { createRouteLimiter, sqliteStore, applyRateLimitHeaders } from './rateLimit';
import { requestContext } from './requestContext';
import type { MochiRequestContext } from './requestContext';
import type { MochiRateLimitStore } from './rateLimit';

const makeRequest = (url = 'http://localhost/x', headers?: Record<string, string>) => new Request(url, { headers });
const clientAddress = (address: string | null) => () => address;

// Custom key/tier/skip/group callbacks read the ambient request context, so their
// checks must run inside one. Provide a minimal fake with the fields those callbacks use.
const withCtx = <T>(ctx: Partial<MochiRequestContext>, fn: () => Promise<T>): Promise<T> =>
  requestContext.run({ locals: {}, getClientAddress: () => null, ...ctx } as MochiRequestContext, fn);

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
    const firstRequestUserA = await withCtx({}, () => limiter.check(makeRequest('http://localhost/x', { 'x-user': 'a' }), clientAddress('same-ip')));
    expect(firstRequestUserA.kind).toBe('allowed');
    const secondRequestUserA = await withCtx({}, () => limiter.check(makeRequest('http://localhost/x', { 'x-user': 'a' }), clientAddress('same-ip')));
    expect(secondRequestUserA.kind).toBe('blocked');
    const firstRequestUserB = await withCtx({}, () => limiter.check(makeRequest('http://localhost/x', { 'x-user': 'b' }), clientAddress('same-ip')));
    expect(firstRequestUserB.kind).toBe('allowed');
  });

  test('custom key receives the request context as its second argument', async () => {
    const limiter = createRouteLimiter({ limit: 1, key: (_req, ctx) => String(ctx.locals.userId) });
    const firstUserA = await withCtx({ locals: { userId: 'u1' } }, () => limiter.check(makeRequest(), clientAddress('same-ip')));
    if (firstUserA.kind !== 'allowed') {
      throw new Error('expected allowed');
    }
    expect(firstUserA.info.key).toBe('u1');
    // Same user (ctx-derived key) drains the same bucket even from the same IP…
    expect((await withCtx({ locals: { userId: 'u1' } }, () => limiter.check(makeRequest(), clientAddress('same-ip')))).kind).toBe('blocked');
    // …while a different user gets their own.
    expect((await withCtx({ locals: { userId: 'u2' } }, () => limiter.check(makeRequest(), clientAddress('same-ip')))).kind).toBe('allowed');
  });

  test('custom key can bucket by the proxy-aware client address via ctx', async () => {
    const limiter = createRouteLimiter({ limit: 1, key: (_req, ctx) => ctx.getClientAddress() ?? 'anon' });
    const outcome = await withCtx({ getClientAddress: () => '9.9.9.9' }, () => limiter.check(makeRequest(), clientAddress(null)));
    if (outcome.kind !== 'allowed') {
      throw new Error('expected allowed');
    }
    expect(outcome.info.key).toBe('9.9.9.9');
  });

  test('skip() bypasses without consuming quota', async () => {
    const limiter = createRouteLimiter({ limit: 1, skip: (request) => new URL(request.url).pathname === '/health' });
    expect((await withCtx({}, () => limiter.check(makeRequest('http://localhost/health'), clientAddress('ip')))).kind).toBe('skip');
    expect((await withCtx({}, () => limiter.check(makeRequest('http://localhost/health'), clientAddress('ip')))).kind).toBe('skip');
    expect((await withCtx({}, () => limiter.check(makeRequest('http://localhost/other'), clientAddress('ip')))).kind).toBe('allowed');
  });

  test('skip receives the request context as its second argument', async () => {
    const limiter = createRouteLimiter({ limit: 1, skip: (_req, ctx) => ctx.locals.bypass === true });
    expect((await withCtx({ locals: { bypass: true } }, () => limiter.check(makeRequest(), clientAddress('ip')))).kind).toBe('skip');
    expect((await withCtx({ locals: { bypass: false } }, () => limiter.check(makeRequest(), clientAddress('ip')))).kind).toBe('allowed');
  });

  test('onStoreError: default allows, deny blocks without limit info', async () => {
    const brokenStore: MochiRateLimitStore = {
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
    expect(outcome.body.message).toBe('Rate limiting unavailable');
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

  test('reset() targets the group-namespaced key of an auto-namespaced limiter', async () => {
    // Stored keys are `group:<autoGroup>:<key>` — a raw-key reset would be a no-op.
    const limiter = createRouteLimiter({ limit: 1 }, '/api/x');
    await limiter.check(makeRequest(), clientAddress('ip'));
    expect((await limiter.check(makeRequest(), clientAddress('ip'))).kind).toBe('blocked');
    await limiter.reset('ip');
    expect((await limiter.check(makeRequest(), clientAddress('ip'))).kind).toBe('allowed');
  });

  test('reset() targets the group-namespaced key of an explicit static group', async () => {
    const limiter = createRouteLimiter({ limit: 1, group: 'team' });
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

  // The wrapped shutdown's finalize sweep depends on hitlimit's private field layout so
  // db.close() actually releases the handle (an outstanding statement only zombies the
  // connection; the leak bites on Windows, where an open handle blocks unlink). bun:sqlite's
  // own tripwire — close(true) throwing on an outstanding statement — was removed in 1.4.0, so
  // these tests verify finalization the version-independent way: a finalized statement throws
  // when reused, and the same own-enumerable-field find() the sweep relies on must locate a
  // statement (else a hitlimit field-layout change slipped through, on every OS and Bun version).
  type Finalizable = { finalize(): void; get(...args: unknown[]): unknown };
  const findStatement = (store: object): Finalizable | undefined =>
    Object.values(store as Record<string, unknown>).find((v): v is Finalizable => typeof (v as { finalize?: unknown } | null)?.finalize === 'function');

  test('shutdown finalizes hitlimit statements so the close fully releases the handle', async () => {
    const store = sqliteStore({ path: path.join(tempDir, 'finalize-check.db') });
    await store.hit('k', 60_000, 5);

    const stmt = findStatement(store);
    expect(stmt).toBeDefined(); // layout tripwire: sweep can't finalize statements it can't find
    expect(() => stmt!.get()).not.toThrow();

    expect(() => store.shutdown!()).not.toThrow();

    // The sweep finalized the statement, so the close released the handle (Windows can unlink).
    expect(() => stmt!.get()).toThrow(/finaliz/i);
  });

  test('negative control: finalizing a statement is what makes it unusable', async () => {
    const raw = hitlimitSqliteStore({ path: path.join(tempDir, 'finalize-control.db') });
    await raw.hit('k', 60_000, 5);

    // Without the sweep the statement stays usable — proving the positive test's post-shutdown
    // throw comes from finalization, not merely from the db being closed underneath it.
    const stmt = findStatement(raw);
    expect(stmt).toBeDefined();
    expect(() => stmt!.get()).not.toThrow();
    stmt!.finalize();
    expect(() => stmt!.get()).toThrow(/finaliz/i);

    // Release the handle for real — otherwise Windows can't unlink finalize-control.db in
    // afterAll (EBUSY). Mirror the production sqliteStore() shutdown: finalize the remaining
    // statements, then close(true) releases the db/-wal/-shm files.
    for (const value of Object.values(raw)) {
      (value as { finalize?: () => void } | null)?.finalize?.();
    }
    (raw as unknown as { db: { close(throwOnError?: boolean): void } }).db.close(true);
    await raw.shutdown?.();
  });
});

describe('applyRateLimitHeaders', () => {
  test('sets headers on a mutable response', () => {
    const response = applyRateLimitHeaders(new Response('ok'), { 'RateLimit-Limit': '5' });
    expect(response.headers.get('RateLimit-Limit')).toBe('5');
  });
});
