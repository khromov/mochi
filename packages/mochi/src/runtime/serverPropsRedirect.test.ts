import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from '../Mochi';
import type { MochiServerPropsResolver } from '../types';
import { fail, redirect } from './forms';
import { getRequestContext } from './requestContext';

describe('redirect() returned from serverProps', () => {
  let server: Server<undefined>;
  let dir: string;
  let base: string;
  let capturedError: unknown;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-serverprops-redirect-'));
    const page = path.join(dir, 'Page.svelte');
    writeFileSync(page, '<script>\n  let { name = "world" } = $props();\n</script>\n\n<h1>hello {name}</h1>\n');
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir: path.join(dir, '.mochi'),
      handleError: ({ error }) => {
        capturedError = error;
      },
      routes: {
        '/go': Mochi.page(page, {
          serverProps: () => redirect(303, '/target'),
        }),
        '/go-cookie': Mochi.page(page, {
          serverProps: () => {
            getRequestContext().cookies.set('sp', '1', { path: '/' });
            return redirect(303, '/target');
          },
        }),
        '/bad-fail': Mochi.page(page, {
          // Deliberately ill-typed: the runtime guard exists for untyped JS and ported code.
          serverProps: (() => fail(400, { error: 'nope' })) as unknown as MochiServerPropsResolver,
        }),
        '/plain': Mochi.page(page, {
          serverProps: () => ({ name: 'props' }),
        }),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test('GET renders a redirect response instead of the page', async () => {
    const res = await fetch(`${base}/go`, { redirect: 'manual' });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/target');
  });

  test('cookies set in serverProps survive the redirect', async () => {
    const res = await fetch(`${base}/go-cookie`, { redirect: 'manual' });
    expect(res.status).toBe(303);
    expect(res.headers.get('Set-Cookie')).toContain('sp=1');
  });

  test('fail() from serverProps is a developer error, not props', async () => {
    capturedError = undefined;
    const res = await fetch(`${base}/bad-fail`);
    expect(res.status).toBe(500);
    expect(String(capturedError)).toContain('serverProps returned fail()');
  });

  test('plain props still render the page', async () => {
    const res = await fetch(`${base}/plain`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('hello props');
  });
});
