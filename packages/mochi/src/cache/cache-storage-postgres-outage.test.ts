import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { MochiCache } from './cache';
import { PostgresStorage } from './cache-storage';
import { sqlCacheTuning } from './sql-backend';
import { startTestPostgres, type TestPostgres } from '../__fixtures__/postgres/startTestPostgres';
import { startBlackHole, startStartupCapture, startTcpProxy, type TcpProxy } from '../__fixtures__/postgres/tcpProxy';
import { mochiEvents } from '../events';

// How PostgresStorage behaves when the database is slow, silent or refusing: each test waits out a real timeout or
// cool-off, so they are kept apart from the rest of the PostgresStorage suite.
const wait = Bun.sleep;

const tuningDefaults = { ...sqlCacheTuning };
let pg: TestPostgres;
const created: PostgresStorage[] = [];
const proxies: TcpProxy[] = [];

beforeAll(async () => {
  pg = await startTestPostgres({ maxConnections: Infinity });
});

afterEach(async () => {
  mochiEvents.all.clear();
  Object.assign(sqlCacheTuning, tuningDefaults);
  for (const proxy of proxies) {
    proxy.stall(false);
  }
  for (const storage of created) {
    await storage.dispose();
  }
  created.length = 0;
  for (const proxy of proxies) {
    proxy.close();
  }
  proxies.length = 0;
});

afterAll(async () => {
  await pg?.close();
});

function makeStorage(options: Partial<ConstructorParameters<typeof PostgresStorage>[0]> = {}): PostgresStorage {
  const storage = new PostgresStorage({ url: pg.url, purgeInterval: 0, ...options });
  created.push(storage);
  return storage;
}

function makeProxy(): { proxy: TcpProxy; url: string } {
  const proxy = startTcpProxy(pg.port);
  proxies.push(proxy);
  return { proxy, url: `postgres://postgres:postgres@127.0.0.1:${proxy.port}/postgres` };
}

describe('PostgresStorage when the database misbehaves', () => {
  test('a statement the server never answers times out, later calls fail fast, and the cache recovers', async () => {
    sqlCacheTuning.queryTimeoutMs = 300;
    sqlCacheTuning.unavailableCooldownMs = 2_000;
    const { proxy, url } = makeProxy();
    const storage = makeStorage({ url });
    const cache = new MochiCache({ storage, minTimeToStale: 60_000, maxTimeToLive: 120_000 });
    expect(await cache.fetch('k', () => 'cached')).toBe('cached');

    const errors: string[] = [];
    mochiEvents.on('cache:error', (e) => errors.push((e.error as Error).name));
    proxy.stall(true);

    let started = performance.now();
    expect(await cache.fetch('k', () => 'recomputed')).toBe('recomputed');
    const first = performance.now() - started;
    expect(first).toBeGreaterThanOrEqual(250);
    expect(first).toBeLessThan(1_500);
    expect(errors[0]).toBe('SqlCacheTimeoutError');

    // Within the cool-off nothing waits on the database again.
    started = performance.now();
    for (let i = 0; i < 20; i++) {
      expect(await cache.fetch(`other-${i}`, () => i)).toBe(i);
    }
    // Twenty reads each waiting out the statement timeout would take six seconds.
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(errors.slice(1).every((name) => name === 'SqlCacheUnavailableError')).toBe(true);

    proxy.stall(false);
    await wait(2_100);
    expect(await cache.fetch('k', () => 'never')).toBe('cached');
    expect(await cache.fetch('k', () => 'never')).toBe('cached');
  });

  test('an unreachable database costs one connection timeout, not one per call', async () => {
    sqlCacheTuning.connectionTimeoutSeconds = 1;
    sqlCacheTuning.unavailableCooldownMs = 10_000;
    const hole = startBlackHole();
    try {
      const storage = makeStorage({ url: `postgres://postgres:postgres@127.0.0.1:${hole.port}/postgres` });
      const cache = new MochiCache({ storage });

      let started = performance.now();
      expect(await cache.fetch('k', () => 'computed')).toBe('computed');
      const first = performance.now() - started;
      // One wait for the read; the write that follows is refused at once instead of waiting a second time.
      expect(first).toBeGreaterThanOrEqual(900);
      expect(first).toBeLessThan(1_900);

      const attempts = hole.accepted();
      started = performance.now();
      for (let i = 0; i < 50; i++) {
        expect(await cache.fetch(`k${i}`, () => i)).toBe(i);
      }
      expect(performance.now() - started).toBeLessThan(1_000);
      expect(hole.accepted()).toBe(attempts);
    } finally {
      hole.close();
    }
  });

  test('a failed open is not repeated on every call', async () => {
    sqlCacheTuning.unavailableCooldownMs = 2_000;
    // A server that refuses every login, and counts them.
    const capture = startStartupCapture();
    try {
      const storage = makeStorage({ url: `postgres://app:pw@127.0.0.1:${capture.port}/app` });
      const messages: string[] = [];
      for (let i = 0; i < 25; i++) {
        await storage.getItem('k').catch((err: Error) => messages.push(err.message));
      }
      expect(messages).toHaveLength(25);
      expect(messages[0]).toMatch(/startup captured/);
      expect(messages.slice(1).every((message) => /failing fast/.test(message))).toBe(true);
      const attempts = capture.startups.length;
      expect(attempts).toBeGreaterThan(0);
      expect(attempts).toBeLessThanOrEqual(sqlCacheTuning.poolMax);

      // After the cool-off a single call tries again, and its failure starts the next one.
      await wait(2_100);
      await expect(storage.getItem('k')).rejects.toThrow(/startup captured/);
      await expect(storage.getItem('k')).rejects.toThrow(/failing fast/);
      expect(capture.startups.length).toBeGreaterThan(attempts);
      expect(capture.startups.length).toBeLessThanOrEqual(attempts + sqlCacheTuning.poolMax);
    } finally {
      capture.close();
    }
  });
});

describe('PostgresStorage idle connections', () => {
  test('idle connections are closed and reopened on demand', async () => {
    sqlCacheTuning.idleTimeoutSeconds = 1;
    const { proxy, url } = makeProxy();
    const storage = makeStorage({ url });
    await storage.setItem('k', { value: 1, createdAt: 0 });
    expect(proxy.open()).toBeGreaterThan(0);
    for (let i = 0; i < 100 && proxy.open() > 0; i++) {
      await wait(100);
    }
    expect(proxy.open()).toBe(0);
    expect(await storage.getItem('k')).toEqual({ value: 1, createdAt: 0 });
  });
});
