import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi, getCspNonce } from './index';

// Separate process (one Mochi.serve() per process) for `csp: true`: the nonce must reach both the framework's own
// script tags and getCspNonce(), and must differ per request. The fixture renders an island *with props* so the
// props JSON block is emitted — the executable-script invariant must hold on a page that carries data blocks too.

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'csp', 'Page.svelte');

let server: Server<undefined>;
let outDir: string;

/** Tag opens for scripts a CSP `script-src` actually gates: no `type`, `type="module"`, or a JS mime. */
function executableScriptTags(html: string): string[] {
  return (html.match(/<script(?=[\s>])[^>]*>/g) ?? []).filter((tag) => {
    const type = /type="([^"]*)"/.exec(tag)?.[1];
    return type === undefined || type === 'module' || type === 'text/javascript';
  });
}

function dataScriptTags(html: string): string[] {
  return (html.match(/<script(?=[\s>])[^>]*>/g) ?? []).filter((tag) => !executableScriptTags(tag).length);
}

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

test('the CSP header nonce matches every executable framework script tag and rotates per request', async () => {
  const res = await fetch(`http://localhost:${server.port}/page`);
  const csp = res.headers.get('content-security-policy') ?? '';
  const nonce = /nonce-([^']+)'/.exec(csp)?.[1];
  expect(nonce).toBeTruthy();

  const html = await res.text();
  // The page must actually carry a props data block, or the invariant below is vacuous.
  expect(dataScriptTags(html).some((tag) => tag.includes('application/json'))).toBe(true);

  const scripts = executableScriptTags(html);
  expect(scripts.length).toBeGreaterThan(0);
  for (const tag of scripts) {
    expect(tag).toContain(`nonce="${nonce}"`);
  }

  const second = await fetch(`http://localhost:${server.port}/page`);
  await second.text();
  expect(second.headers.get('content-security-policy')).not.toBe(csp);
});

test('getCspNonce() is importable from a .svelte component and returns the request nonce', async () => {
  const res = await fetch(`http://localhost:${server.port}/page`);
  const html = await res.text();
  expect(html).toContain('data-has-nonce="true"');
});

test('the 404 error page carries the nonce on its framework scripts', async () => {
  const res = await fetch(`http://localhost:${server.port}/nope`);
  expect(res.status).toBe(404);
  const csp = res.headers.get('content-security-policy') ?? '';
  const nonce = /nonce-([^']+)'/.exec(csp)?.[1];
  expect(nonce).toBeTruthy();

  const scripts = executableScriptTags(await res.text());
  expect(scripts.length).toBeGreaterThan(0);
  for (const tag of scripts) {
    expect(tag).toContain(`nonce="${nonce}"`);
  }
});
