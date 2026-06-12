import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { redirect, success } from './forms';
import { getRequestContext } from './requestContext';

// One production Mochi.serve() (only one is allowed per process) exercising the
// hardening wired into Mochi.ts end-to-end: secure cookie defaults, the request
// body cap, the same-origin redirect guard, and the default security headers.
// The development-mode cookie case lives in its own file (separate process).

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'css-imports', 'Page.svelte');

let server: Server<undefined>;
let outDir: string;
let base: string;

beforeAll(async () => {
  outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-sec-integration-'));
  server = await Mochi.serve({
    port: 0,
    development: false,
    proxy: { hostHeader: 'host' },
    logger: { enabled: false },
    outDir,
    maxRequestBodySize: 1000,
    routes: {
      '/set': Mochi.api(() => {
        getRequestContext().cookies.set('session', 'abc');
        return new Response('ok');
      }),
      '/api/ok': Mochi.api(() => new Response('ok')),
      '/sse/tick': Mochi.sse((stream) => {
        stream.send('tick');
        stream.close();
      }),
      '/page': Mochi.page(FIXTURE_PAGE, {
        actions: {
          default: () => success(),
          safe: () => redirect(303, '/ok'),
          evil: () => redirect(303, 'https://evil.example/phish'),
        },
      }),
    },
  });
  base = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  rmSync(outDir, { recursive: true, force: true });
});

describe('secure cookie defaults (production)', () => {
  test('cookie is HttpOnly, SameSite=Lax, and Secure', async () => {
    const res = await fetch(`${base}/set`);
    const setCookie = (res.headers.get('set-cookie') ?? '').toLowerCase();
    expect(setCookie).toContain('httponly');
    expect(setCookie).toContain('samesite=lax');
    expect(setCookie).toContain('secure');
  });
});

describe('request body size limit', () => {
  test('an over-limit form POST returns 413', async () => {
    const res = await fetch(`${base}/page`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base },
      body: 'a=' + 'x'.repeat(2000),
    });
    expect(res.status).toBe(413);
  });

  test('an under-limit form POST runs the action', async () => {
    const res = await fetch(`${base}/page`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base },
      body: 'a=1',
    });
    expect(res.status).toBe(200);
  });
});

describe('same-origin redirect guard', () => {
  test('allows a same-origin (relative) redirect', async () => {
    const res = await fetch(`${base}/page?/safe`, {
      method: 'POST',
      headers: { accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded', origin: base },
      body: '',
      redirect: 'manual',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/ok');
  });

  test('blocks an off-origin redirect with 500', async () => {
    const res = await fetch(`${base}/page?/evil`, {
      method: 'POST',
      headers: { accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded', origin: base },
      body: '',
      redirect: 'manual',
    });
    expect(res.status).toBe(500);
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('default security headers', () => {
  test('API responses carry the baseline headers', async () => {
    const res = await fetch(`${base}/api/ok`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  });

  test('SSE responses carry the baseline headers', async () => {
    const res = await fetch(`${base}/sse/tick`);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    await res.body?.cancel();
  });
});
