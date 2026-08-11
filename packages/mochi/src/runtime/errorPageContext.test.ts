import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from '../Mochi';

const THROWING_PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'throwing', 'Throws.svelte');

// Regression: the unmatched-route 404 fallback used to render the error page outside any request
// context, so an errorPage calling getRequestContext() produced the plain-text double-failure body.
describe('error page renders inside a request context', () => {
  let server: Server<undefined>;
  let dir: string;
  let base: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-error-page-context-'));
    const errorPage = path.join(dir, 'Error.svelte');
    writeFileSync(
      errorPage,
      `<script>\n` +
        `  import { getRequestContext } from 'mochi-framework';\n` +
        `  let { error } = $props();\n` +
        `  const ctx = getRequestContext();\n` +
        `  ctx.cookies.set('errctx', '1', { path: '/' });\n` +
        `</script>\n\n` +
        `<h1>error {error.status}</h1>\n` +
        `<p data-path>{ctx.url.pathname}</p>\n`,
    );
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir: path.join(dir, '.mochi'),
      errorPage,
      routes: { '/': Mochi.page(THROWING_PAGE) },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test('unmatched-route 404 renders the context-using error page', async () => {
    const res = await fetch(`${base}/definitely-not-a-route`);
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain('error 404');
    expect(body).toContain('/definitely-not-a-route');
    expect(body).not.toContain('The error page also failed to render');
  });

  test('cookies set by the error page reach the 404 response', async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.headers.get('Set-Cookie')).toContain('errctx=1');
  });

  test('a throwing route still renders the same error page from its ambient context', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toContain('error 500');
    expect(res.headers.get('Set-Cookie')).toContain('errctx=1');
  });
});
