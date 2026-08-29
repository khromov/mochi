// Boots a real Mochi.serve() and fires HEAD requests end-to-end to lock in that
// HEAD reuses GET/handler logic while returning an empty body. Only one
// Mochi.serve() is allowed per process, so the dev-mode case lives in
// head.dev.test.ts and the trailing-slash case in trailingSlash.never.test.ts.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { mochiEvents } from './events';
import { success } from './runtime/forms';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'css-imports', 'Page.svelte');

describe('HEAD requests', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-head-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {
        '/': Mochi.page(FIXTURE_PAGE),
        '/with-action': Mochi.page(FIXTURE_PAGE, {
          actions: { default: () => success({}) },
        }),
        '/api/ping': Mochi.api(({ method }) => Response.json({ method })),
        '/sse': Mochi.sse((stream) => {
          stream.send('hello');
        }),
        '/ws': Mochi.ws({ message() {} }),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('plain page: HEAD mirrors GET status/headers with an empty body and matching Content-Length', async () => {
    const get = await fetch(`${base}/`);
    const getBody = await get.text();
    expect(get.status).toBe(200);

    const head = await fetch(`${base}/`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Type')).toBe(get.headers.get('Content-Type'));
    expect(await head.text()).toBe('');
    expect(head.headers.get('Content-Length')).toBe(String(Buffer.byteLength(getBody, 'utf8')));
  });

  test('page with form actions: HEAD is 200, not 405 (method-keyed route object)', async () => {
    const head = await fetch(`${base}/with-action`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  test('api route: HEAD mirrors GET status/headers with an empty body', async () => {
    const get = await fetch(`${base}/api/ping`);
    expect(get.status).toBe(200);
    expect(get.headers.get('Content-Type')).toContain('application/json');

    const head = await fetch(`${base}/api/ping`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Type')).toContain('application/json');
    expect(await head.text()).toBe('');
  });

  test('404: HEAD returns 404 with an empty body (composedFetch path)', async () => {
    const head = await fetch(`${base}/does-not-exist`, { method: 'HEAD' });
    expect(head.status).toBe(404);
    expect(await head.text()).toBe('');
  });

  test('sse: HEAD is not supported — returns 405 Allow: GET, emits a request event, and does not open a stream', async () => {
    let opened = false;
    const onOpen = (): void => {
      opened = true;
    };
    const requests: Array<{ method: string; path: string; status: number }> = [];
    const onRequest = (e: { method: string; path: string; status: number }): void => {
      requests.push(e);
    };
    mochiEvents.on('sse:open', onOpen);
    mochiEvents.on('request', onRequest);
    try {
      const head = await fetch(`${base}/sse`, { method: 'HEAD' });
      expect(head.status).toBe(405);
      expect(head.headers.get('Allow')).toBe('GET');
      expect(await head.text()).toBe('');
    } finally {
      mochiEvents.off('sse:open', onOpen);
      mochiEvents.off('request', onRequest);
    }
    expect(opened).toBe(false);
    expect(requests).toContainEqual(expect.objectContaining({ method: 'HEAD', path: '/sse', status: 405 }));
  });

  test('ws: a same-origin non-upgrade request fails with 400 and emits a request event', async () => {
    const requests: Array<{ method: string; path: string; status: number }> = [];
    const onRequest = (e: { method: string; path: string; status: number }): void => {
      requests.push(e);
    };
    mochiEvents.on('request', onRequest);
    try {
      const res = await fetch(`${base}/ws`, { headers: { Origin: base } });
      expect(res.status).toBe(400);
    } finally {
      mochiEvents.off('request', onRequest);
    }
    expect(requests).toContainEqual(expect.objectContaining({ method: 'GET', path: '/ws', status: 400 }));
  });
});
