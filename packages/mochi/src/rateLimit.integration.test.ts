import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { getRequestContext } from './requestContext';
import { json } from './utils';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'css-imports', 'Page.svelte');

describe('rateLimit route option', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-ratelimit-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      rateLimit: { limit: 2, window: '1m' },
      routes: {
        '/api/global': Mochi.api(async () => json({ ok: true })),
        '/api/global-shared': Mochi.api(async () => json({ ok: true })),
        '/api/override': Mochi.api(async () => json({ ok: true }), { rateLimit: { limit: 5, window: '1m' } }),
        '/api/optout': Mochi.api(async () => json({ ok: true }), { rateLimit: false }),
        '/api/info': Mochi.api(async () => json({ rateLimit: getRequestContext().rateLimit ?? null }), {
          rateLimit: { limit: 9, window: '1m' },
        }),
        '/api/keyed': Mochi.api(async () => json({ ok: true }), {
          rateLimit: { limit: 1, window: '1m', key: (req) => req.headers.get('x-user') ?? 'anon' },
        }),
        '/api/keyed-ctx': Mochi.api(async () => json({ ok: true }), {
          rateLimit: { limit: 1, window: '1m', key: (_req, ctx) => ctx.cookies.get('uid') ?? 'anon' },
        }),
        '/page': Mochi.page(FIXTURE_PAGE, { rateLimit: { limit: 1, window: '1m' } }),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('per-route override beats the global default, then blocks with hitlimit JSON', async () => {
    for (let i = 0; i < 5; i++) {
      const response = await fetch(`${base}/api/override`);
      expect(response.status).toBe(200);
      expect(response.headers.get('RateLimit-Limit')).toBe('5');
      expect(response.headers.get('RateLimit-Remaining')).toBe(String(4 - i));
    }
    const blockedResponse = await fetch(`${base}/api/override`);
    expect(blockedResponse.status).toBe(429);
    expect(blockedResponse.headers.get('Retry-After')).toBeDefined();
    expect(blockedResponse.headers.get('RateLimit-Remaining')).toBe('0');
    const body = (await blockedResponse.json()) as { hitlimit: boolean; remaining: number; resetIn: number };
    expect(body.hitlimit).toBe(true);
    expect(body.remaining).toBe(0);
    expect(body.resetIn).toBeGreaterThan(0);
  });

  test('routes without their own config share the global limiter bucket', async () => {
    const firstResponse = await fetch(`${base}/api/global`);
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get('RateLimit-Limit')).toBe('2');
    // Second hit lands on a DIFFERENT route but the SAME shared bucket.
    const secondResponse = await fetch(`${base}/api/global-shared`);
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.headers.get('RateLimit-Remaining')).toBe('0');
    const thirdResponse = await fetch(`${base}/api/global`);
    expect(thirdResponse.status).toBe(429);
  });

  test('rateLimit: false opts a route out entirely', async () => {
    for (let i = 0; i < 10; i++) {
      const response = await fetch(`${base}/api/optout`);
      expect(response.status).toBe(200);
      expect(response.headers.get('RateLimit-Limit')).toBeNull();
    }
  });

  test('getRequestContext().rateLimit exposes usage to handlers', async () => {
    const response = await fetch(`${base}/api/info`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { rateLimit: { limit: number; remaining: number; resetIn: number; key: string } };
    expect(body.rateLimit.limit).toBe(9);
    expect(body.rateLimit.remaining).toBe(8);
    expect(body.rateLimit.resetIn).toBeGreaterThan(0);
    expect(body.rateLimit.key.length).toBeGreaterThan(0);
  });

  test('custom key isolates callers sharing an IP', async () => {
    expect((await fetch(`${base}/api/keyed`, { headers: { 'x-user': 'a' } })).status).toBe(200);
    expect((await fetch(`${base}/api/keyed`, { headers: { 'x-user': 'a' } })).status).toBe(429);
    expect((await fetch(`${base}/api/keyed`, { headers: { 'x-user': 'b' } })).status).toBe(200);
  });

  test('custom key can bucket by request context (cookie) at limiter time', async () => {
    expect((await fetch(`${base}/api/keyed-ctx`, { headers: { cookie: 'uid=alice' } })).status).toBe(200);
    expect((await fetch(`${base}/api/keyed-ctx`, { headers: { cookie: 'uid=alice' } })).status).toBe(429);
    expect((await fetch(`${base}/api/keyed-ctx`, { headers: { cookie: 'uid=bob' } })).status).toBe(200);
  });

  test('blocked page route renders the HTML error page at 429 with headers', async () => {
    const allowedResponse = await fetch(`${base}/page`);
    expect(allowedResponse.status).toBe(200);
    expect(allowedResponse.headers.get('content-type')).toContain('text/html');
    expect(allowedResponse.headers.get('RateLimit-Limit')).toBe('1');

    const blockedResponse = await fetch(`${base}/page`);
    expect(blockedResponse.status).toBe(429);
    expect(blockedResponse.headers.get('content-type')).toContain('text/html');
    expect(blockedResponse.headers.get('RateLimit-Remaining')).toBe('0');
    expect(blockedResponse.headers.get('Retry-After')).toBeDefined();
    const html = await blockedResponse.text();
    expect(html).toContain('429');
    expect(html).toContain('Rate limit exceeded');
  });
});
