import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from '../Mochi';
import type { HandleError } from './hooks';

// Previously .isolated.test.ts — all tests now run in isolated processes.
//
// Regression: with `trailingSlash: 'always'`, a handleError that compares
// `event.url.pathname` against a no-slash literal silently misses, the override
// Response is never returned, and the error page renders instead of redirecting.
// See packages/site/src/index.ts for the demo this came from.

const THROWING_PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'throwing', 'Throws.svelte');

describe('handleError returning Response.redirect', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  const handleError: HandleError = ({ event }) => {
    if (event.url.pathname === '/redirect-me/') {
      return Response.redirect(new URL('/landing', event.url), 302);
    }
  };

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-handle-error-redirect-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      trailingSlash: 'always',
      handleError,
      routes: {
        '/redirect-me': Mochi.page(THROWING_PAGE),
        '/no-override': Mochi.page(THROWING_PAGE),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('throwing page short-circuits to the redirect Response', async () => {
    const res = await fetch(`${base}/redirect-me/`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${base}/landing`);
  });

  test('non-matching path falls through to the error page', async () => {
    const res = await fetch(`${base}/no-override/`, { redirect: 'manual' });
    expect(res.status).toBe(500);
    expect(res.headers.get('Location')).toBeNull();
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });
});
