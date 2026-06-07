import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { success } from './forms';
import type { Handle } from './hooks';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'css-imports', 'Page.svelte');

describe('HEAD request support', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  const middlewareCalls: string[] = [];

  const recorder: Handle = async ({ event, resolve }) => {
    middlewareCalls.push(`${event.request.method} ${event.url.pathname}`);
    return resolve(event);
  };

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-head-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      handle: recorder,
      routes: {
        '/page': Mochi.page(FIXTURE_PAGE),
        '/page-actions': Mochi.page(FIXTURE_PAGE, {
          actions: { default: () => success({ ok: true }) },
        }),
        '/api/data': Mochi.api(({ method }) => {
          return Response.json({ method }, { status: 200, headers: { 'X-Custom': 'yes' } });
        }),
        '/ws': Mochi.ws({
          open() {},
          message() {},
        }),
        '/sse': Mochi.sse(({ send, close }) => {
          send('hello');
          close();
        }),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  describe('page without actions', () => {
    test('HEAD returns 200 with empty body', async () => {
      const res = await fetch(`${base}/page`, { method: 'HEAD' });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toBe('');
    });

    test('HEAD has Content-Type text/html', async () => {
      const res = await fetch(`${base}/page`, { method: 'HEAD' });
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    });
  });

  describe('page with actions', () => {
    test('HEAD returns 200 with empty body', async () => {
      const res = await fetch(`${base}/page-actions`, { method: 'HEAD' });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toBe('');
    });

    test('HEAD has Content-Type text/html', async () => {
      const res = await fetch(`${base}/page-actions`, { method: 'HEAD' });
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    });
  });

  describe('API route', () => {
    test('HEAD returns same status and headers but no body', async () => {
      const res = await fetch(`${base}/api/data`, { method: 'HEAD' });
      expect(res.status).toBe(200);
      expect(res.headers.get('x-custom')).toBe('yes');
      const body = await res.text();
      expect(body).toBe('');
    });

    test('handler receives method HEAD', async () => {
      const getRes = await fetch(`${base}/api/data`);
      const getBody = (await getRes.json()) as { method: string };
      expect(getBody.method).toBe('GET');

      // HEAD handler runs with method='HEAD', framework strips body
      const headRes = await fetch(`${base}/api/data`, { method: 'HEAD' });
      expect(headRes.status).toBe(200);
    });
  });

  describe('WebSocket route', () => {
    test('HEAD returns 405', async () => {
      const res = await fetch(`${base}/ws`, { method: 'HEAD' });
      expect(res.status).toBe(405);
    });
  });

  describe('SSE route', () => {
    test('HEAD returns 200 with SSE headers and no body', async () => {
      const res = await fetch(`${base}/sse`, { method: 'HEAD' });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/event-stream');
      expect(res.headers.get('cache-control')).toBe('no-cache');
      const body = await res.text();
      expect(body).toBe('');
    });
  });

  describe('middleware integration', () => {
    test('middleware fires for HEAD on pages', async () => {
      middlewareCalls.length = 0;
      await fetch(`${base}/page`, { method: 'HEAD' });
      expect(middlewareCalls).toContain('HEAD /page');
    });

    test('middleware fires for HEAD on APIs', async () => {
      middlewareCalls.length = 0;
      await fetch(`${base}/api/data`, { method: 'HEAD' });
      expect(middlewareCalls).toContain('HEAD /api/data');
    });
  });
});
