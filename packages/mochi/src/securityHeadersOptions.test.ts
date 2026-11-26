// `securityHeaders` and the `security:headers` filter change what every response class sends, and `frameOptions` steps
// aside for a response that publishes a CSP `frame-ancestors` allow-list.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import type { Handle } from './runtime/hooks';

const PLAIN_PAGE = path.join(import.meta.dir, '__fixtures__', 'css-imports', 'Page.svelte');
const EMBED_POLICY = "frame-ancestors 'self' https://partner.example";

let server: Server<undefined>;
let outDir: string;
let fixtures: string;
let base: string;

const embeddable: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  if (event.url.pathname === '/embeddable') {
    response.headers.set('Content-Security-Policy', EMBED_POLICY);
  }
  return response;
};

beforeAll(async () => {
  outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-sec-headers-opts-'));
  fixtures = mkdtempSync(path.join(import.meta.dir, '..', 'mochi-file-fixtures-sec-opts-'));
  mkdirSync(path.join(fixtures, 'public'));
  mkdirSync(path.join(fixtures, 'media'));
  writeFileSync(path.join(fixtures, 'public', 'note.txt'), 'public note');
  writeFileSync(path.join(fixtures, 'media', 'upload.txt'), 'uploaded file');

  server = await Mochi.serve({
    port: 0,
    development: false,
    logger: { enabled: false },
    outDir,
    publicDir: path.join(fixtures, 'public'),
    staticDirs: { '/media': path.join(fixtures, 'media') },
    securityHeaders: { frameOptions: 'DENY', referrerPolicy: 'no-referrer' },
    filters: {
      'security:headers': ({ 'X-Content-Type-Options': _dropped, ...headers }) => ({ ...headers, 'Strict-Transport-Security': 'max-age=63072000' }),
    },
    handle: embeddable,
    routes: {
      '/page': Mochi.page(PLAIN_PAGE),
      '/embeddable': Mochi.page(PLAIN_PAGE),
      '/api/embed': Mochi.api(() => new Response('ok', { headers: { 'Content-Security-Policy': EMBED_POLICY } })),
    },
  });
  base = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  rmSync(outDir, { recursive: true, force: true });
  rmSync(fixtures, { recursive: true, force: true });
});

function expectConfigured(res: Response, frameOptions: string | null = 'DENY'): void {
  expect(res.headers.get('x-frame-options')).toBe(frameOptions);
  expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  expect(res.headers.get('strict-transport-security')).toBe('max-age=63072000');
  expect(res.headers.get('x-content-type-options')).toBeNull();
}

describe('configured security headers', () => {
  test.each([['/page'], ['/note.txt'], ['/media/upload.txt'], ['/nope']])('%s gets the option and filter result', async (pathname) => {
    const res = await fetch(`${base}${pathname}`);
    await res.arrayBuffer();
    expectConfigured(res);
  });

  test('X-Frame-Options is skipped when a route sends frame-ancestors', async () => {
    const res = await fetch(`${base}/api/embed`);
    expect(res.headers.get('content-security-policy')).toBe(EMBED_POLICY);
    expectConfigured(res, null);
  });

  test('X-Frame-Options is skipped when middleware sends frame-ancestors', async () => {
    const res = await fetch(`${base}/embeddable`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe(EMBED_POLICY);
    expectConfigured(res, null);
  });
});
