import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi, getCspNonce } from './index';

// Separate process (one Mochi.serve() per process) for `csp: true`: the nonce must reach both the framework's own
// script tags and getCspNonce(), and must differ per request.

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'island-context', 'Page.svelte');

let server: Server<undefined>;
let outDir: string;

beforeAll(async () => {
  outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-csp-'));
  server = await Mochi.serve({
    port: 0,
    development: false,
    logger: { enabled: false },
    outDir,
    csp: true,
    handle: async ({ event, resolve }) => {
      const response = await resolve(event);
      const nonce = getCspNonce();
      if (nonce) {
        response.headers.set('Content-Security-Policy', `script-src 'nonce-${nonce}' 'strict-dynamic'`);
      }
      return response;
    },
    routes: { '/page': Mochi.page(FIXTURE_PAGE) },
  });
});

afterAll(() => {
  server.stop(true);
  rmSync(outDir, { recursive: true, force: true });
});

test('the CSP header nonce matches every framework script tag and rotates per request', async () => {
  const res = await fetch(`http://localhost:${server.port}/page`);
  const csp = res.headers.get('content-security-policy') ?? '';
  const nonce = /nonce-([^']+)'/.exec(csp)?.[1];
  expect(nonce).toBeTruthy();

  const html = await res.text();
  const scripts = html.match(/<script(?=[\s>])[^>]*>/g) ?? [];
  expect(scripts.length).toBeGreaterThan(0);
  for (const tag of scripts) {
    expect(tag).toContain(`nonce="${nonce}"`);
  }

  const second = await fetch(`http://localhost:${server.port}/page`);
  await second.text();
  expect(second.headers.get('content-security-policy')).not.toBe(csp);
});
