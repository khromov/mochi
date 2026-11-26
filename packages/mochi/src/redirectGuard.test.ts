import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { redirect, success } from './runtime/forms';

// Production with a configured `proxy`, so the guard compares against the trusted public origin. The unconfigured and
// development cases need their own Mochi.serve() and live in sibling files.

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'css-imports', 'Page.svelte');

let server: Server<undefined>;
let outDir: string;
let base: string;

beforeAll(async () => {
  outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-redirect-guard-'));
  server = await Mochi.serve({
    port: 0,
    development: false,
    proxy: { hostHeader: 'host' },
    logger: { enabled: false },
    outDir,
    csrf: { trustedOrigins: ['https://csrf-only.example'] },
    redirect: { trustedOrigins: ['https://redirect-ok.example'] },
    routes: {
      '/loader-external': Mochi.page(FIXTURE_PAGE, {
        serverProps: () => redirect(303, 'https://anywhere.example/sso', { external: true }),
      }),
      '/loader-redirect': Mochi.page(FIXTURE_PAGE, {
        serverProps: (req) => redirect(303, new URL(req.url).searchParams.get('next') ?? '/'),
      }),
      '/page': Mochi.page(FIXTURE_PAGE, {
        actions: {
          default: () => success(),
          safe: () => redirect(303, '/ok'),
          sameOriginAbsolute: ({ url }) => redirect(303, `${url.origin}/ok`),
          evil: () => redirect(303, 'https://evil.example/phish'),
          redirectAllowed: () => redirect(303, 'https://redirect-ok.example/next'),
          csrfTrusted: () => redirect(303, 'https://csrf-only.example/next'),
          external: () => redirect(303, 'https://anywhere.example/sso', { external: true }),
          externalInjection: () => redirect(303, 'https://anywhere.example/sso\r\nX-Injected: 1', { external: true }),
          mailto: () => redirect(303, 'mailto:hi@example.com?subject=Hi'),
          tel: () => redirect(303, 'tel:+15551234567'),
          appScheme: () => redirect(303, 'myapp://open/thing'),
          javascriptScheme: () => redirect(303, 'javascript:alert(1)', { external: true }),
          dataScheme: () => redirect(303, 'data:text/html,<script>alert(1)</script>'),
        },
      }),
    },
  });
  base = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  rmSync(outDir, { recursive: true, force: true });
});

const post = (action: string, accept = 'text/html'): Promise<Response> =>
  fetch(`${base}/page?/${action}`, {
    method: 'POST',
    headers: { accept, 'content-type': 'application/x-www-form-urlencoded', origin: base },
    body: '',
    redirect: 'manual',
  });

describe('same-origin redirect guard', () => {
  test('allows a relative redirect', async () => {
    const res = await post('safe');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/ok');
  });

  test('allows an absolute redirect to the configured origin', async () => {
    const res = await post('sameOriginAbsolute');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${base}/ok`);
  });

  test('blocks an off-origin redirect with 500', async () => {
    const res = await post('evil');
    expect(res.status).toBe(500);
    expect(res.headers.get('location')).toBeNull();
  });

  test('blocks an off-origin redirect on the enhanced JSON path', async () => {
    const res = await post('evil', 'application/json');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ type: 'error', status: 500, error: { message: 'Unsafe redirect location' } });
  });

  test('blocks an off-origin redirect returned from serverProps', async () => {
    const res = await fetch(`${base}/loader-redirect?next=https://evil.example/phish`, { redirect: 'manual' });
    expect(res.status).toBe(500);
    expect(res.headers.get('location')).toBeNull();
  });

  test('allows a relative redirect from serverProps', async () => {
    const res = await fetch(`${base}/loader-redirect?next=/ok`, { redirect: 'manual' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/ok');
  });

  test('redirect.trustedOrigins allows its origins, csrf.trustedOrigins does not', async () => {
    const allowed = await post('redirectAllowed');
    expect(allowed.status).toBe(303);
    expect(allowed.headers.get('location')).toBe('https://redirect-ok.example/next');

    const csrfOnly = await post('csrfTrusted');
    expect(csrfOnly.status).toBe(500);
    expect(csrfOnly.headers.get('location')).toBeNull();
  });
});

describe('per-call external redirect', () => {
  test('redirect({ external: true }) leaves an off-origin location alone', async () => {
    const res = await post('external');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://anywhere.example/sso');
  });

  test('works from serverProps too', async () => {
    const res = await fetch(`${base}/loader-external`, { redirect: 'manual' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://anywhere.example/sso');
  });

  test('still rejects a location carrying control characters', async () => {
    const res = await post('externalInjection');
    expect(res.status).toBe(500);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-injected')).toBeNull();
  });
});

describe('redirect() URL schemes', () => {
  test.each([
    ['mailto', 'mailto:hi@example.com?subject=Hi'],
    ['tel', 'tel:+15551234567'],
    ['appScheme', 'myapp://open/thing'],
  ])('allows a %s redirect without an opt-out', async (action, location) => {
    const res = await post(action);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(location);
  });

  test.each([['javascriptScheme'], ['dataScheme']])('blocks a %s redirect, which { external: true } does not waive', async (action) => {
    const res = await post(action);
    expect(res.status).toBe(500);
    expect(res.headers.get('location')).toBeNull();
  });
});

// Whether `https:/host` is a path or an authority depends on the scheme of the URL it is resolved against, so a guard
// that resolves against a fixed base would disagree with the browser.
describe('redirect() location battery', () => {
  const go = (next: string): Promise<Response> => fetch(`${base}/loader-redirect?next=${encodeURIComponent(next)}`, { redirect: 'manual' });

  test.each([['/ok'], ['/a/b?x=1#f'], ['mailto:a@b.com'], ['tel:+15551234'], ['sms:+1555'], ['myapp://open'], ['intent://scan#Intent;end']])('allows %s', async (next) => {
    const res = await go(next);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(next);
  });

  test.each([
    ['//evil.example/x'],
    ['///evil.example'],
    ['/\\evil.example'],
    ['\\\\evil.example'],
    ['https://evil.example'],
    ['HTTPS://EVIL.example'],
    ['https://user@evil.example'],
    ['https:/evil.example'],
    ['https:evil.example'],
    ['http:/evil.example'],
    ['javascript:alert(1)'],
    ['JavaScript:alert(1)'],
    [' javascript:alert(1)'],
    ['java\tscript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['vbscript:msgbox(1)'],
    ['blob:https://evil.example/u'],
    ['file:///etc/passwd'],
    ['view-source:https://x.example'],
  ])('blocks %s', async (next) => {
    const res = await go(next);
    expect(res.status).toBe(500);
    expect(res.headers.get('location')).toBeNull();
  });
});
