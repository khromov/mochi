import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from '../Mochi';

// Boots a real Mochi.serve() and fires real fetch() calls so a regression at
// any of the three csrfCheck() wiring sites in Mochi.ts (page handler, api
// handler, composedFetch) surfaces here. Runs in production mode so the check
// returns 403 instead of warning-and-passing.

const FIXTURE_PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'css-imports', 'Page.svelte');

describe('csrf wiring through Mochi.serve()', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-csrf-integration-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      // hostHeader makes the expected origin port-agnostic: it falls out of the
      // standard Host header that fetch always sends, so we don't need to know
      // server.port up front.
      proxy: { hostHeader: 'host' },
      logger: { enabled: false },
      outDir,
      routes: {
        '/api/echo': Mochi.api(() => new Response('ok', { status: 200 })),
        '/page': Mochi.page(FIXTURE_PAGE),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('page handler: cross-origin form POST → 403', async () => {
    const res = await fetch(`${base}/page`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'http://evil.example',
      },
      body: 'a=1',
    });
    expect(res.status).toBe(403);
  });

  test('page handler: same-origin GET → not 403', async () => {
    const res = await fetch(`${base}/page`, {
      method: 'GET',
      headers: { origin: base },
    });
    expect(res.status).not.toBe(403);
  });

  test('api handler: cross-origin form POST → 403', async () => {
    const res = await fetch(`${base}/api/echo`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'http://evil.example',
      },
      body: 'a=1',
    });
    expect(res.status).toBe(403);
  });

  test('api handler: same-origin form POST → not 403', async () => {
    const res = await fetch(`${base}/api/echo`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: base,
      },
      body: 'a=1',
    });
    expect(res.status).not.toBe(403);
    expect(await res.text()).toBe('ok');
  });

  test('api handler: cross-origin JSON POST → not 403 (CORS preflight protects JSON)', async () => {
    const res = await fetch(`${base}/api/echo`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://evil.example',
      },
      body: '{}',
    });
    expect(res.status).not.toBe(403);
    expect(await res.text()).toBe('ok');
  });

  test('api handler: cross-origin POST with no Content-Type → 403 (no preflight, must be gated)', async () => {
    const res = await fetch(`${base}/api/echo`, {
      method: 'POST',
      headers: { origin: 'http://evil.example' },
      body: new Blob([''], { type: '' }),
    });
    expect(res.status).toBe(403);
  });

  test('composedFetch: cross-origin form POST to unrouted path → 403 (not 404)', async () => {
    const res = await fetch(`${base}/__nonexistent__`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'http://evil.example',
      },
      body: 'a=1',
    });
    expect(res.status).toBe(403);
  });

  test('cross-origin GET to unrouted path → not 403 (exempt method)', async () => {
    const res = await fetch(`${base}/__nonexistent__`, {
      method: 'GET',
      headers: { origin: 'http://evil.example' },
    });
    expect(res.status).not.toBe(403);
  });
});
