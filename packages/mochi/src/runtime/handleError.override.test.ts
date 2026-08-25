import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from '../Mochi';
import type { HandleError } from './hooks';

// Pins the override protocol shared by the HTML error page and the enhanced JSON path (resolveErrorOverride):
// a `{ status, message }` override applies, a malformed override is rejected with the defaults kept, and a
// Response short-circuits — on BOTH paths.

const THROWING_PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'throwing', 'Throws.svelte');
const FIXTURE_PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'css-imports', 'Page.svelte');

describe('handleError override protocol', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  const handleError: HandleError = ({ event }) => {
    switch (event.url.pathname) {
      case '/obj':
      case '/act-obj':
        return { status: 503, message: 'Overridden message' };
      case '/invalid':
      case '/act-invalid':
        // Missing `message` — must be rejected and logged, keeping the defaults.
        return { status: 400 } as unknown as { status: number; message: string };
      case '/act-resp':
        return Response.json({ custom: true }, { status: 418 });
    }
  };

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-handle-error-override-'));
    const actions = {
      exploding: () => {
        throw new Error('boom');
      },
    };
    server = await Mochi.serve({
      port: 0,
      development: false,
      proxy: { hostHeader: 'host' },
      logger: { enabled: false },
      outDir,
      handleError,
      routes: {
        '/obj': Mochi.page(THROWING_PAGE),
        '/invalid': Mochi.page(THROWING_PAGE),
        '/act-obj': Mochi.page(FIXTURE_PAGE, { actions }),
        '/act-invalid': Mochi.page(FIXTURE_PAGE, { actions }),
        '/act-resp': Mochi.page(FIXTURE_PAGE, { actions }),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  function postAction(pathname: string): Promise<Response> {
    return fetch(`${base}${pathname}?/exploding`, {
      method: 'POST',
      headers: { accept: 'application/json', 'x-mochi-action': 'true', 'content-type': 'application/x-www-form-urlencoded', origin: base },
      body: '',
    });
  }

  test('HTML path: { status, message } override drives the error page', async () => {
    const res = await fetch(`${base}/obj`);
    expect(res.status).toBe(503);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(await res.text()).toContain('Overridden message');
  });

  test('HTML path: a malformed override is rejected and the defaults kept', async () => {
    const res = await fetch(`${base}/invalid`);
    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  test('enhanced path: { status, message } override lands in the JSON envelope', async () => {
    const res = await postAction('/act-obj');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { type: string; error?: { message: string } };
    expect(body.type).toBe('error');
    expect(body.error?.message).toBe('Overridden message');
  });

  test('enhanced path: a malformed override keeps the thrown error message, never undefined', async () => {
    const res = await postAction('/act-invalid');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { type: string; error?: { message: string } };
    expect(body.type).toBe('error');
    expect(body.error?.message).toBe('boom');
  });

  test('enhanced path: a Response override short-circuits verbatim', async () => {
    const res = await postAction('/act-resp');
    expect(res.status).toBe(418);
    expect((await res.json()) as { custom: boolean }).toEqual({ custom: true });
  });
});
