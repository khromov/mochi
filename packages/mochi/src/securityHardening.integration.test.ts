import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { redirect, success } from './runtime/forms';
import { getRequestContext } from './runtime/requestContext';

// One production Mochi.serve() (only one is allowed per process) exercising the hardening wired into Mochi.ts
// end-to-end: opt-in secure cookie defaults, the same-origin redirect guard, and the baseline security headers.
// The development-mode cookie case lives in its own file (separate process).

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'css-imports', 'Page.svelte');

let server: Server<undefined>;
let outDir: string;
let assetRoot: string;
let base: string;
let port: number;

/** Raw HTTP/1.1 upgrade handshake — `fetch` cannot set `Upgrade`/`Connection`, and the token list is the point. */
function upgradeStatusLine(port: number, headers: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const done = (): void => {
      if (buf) {
        resolve(buf.split('\r\n')[0] ?? '');
      }
    };
    Bun.connect({
      hostname: '127.0.0.1',
      port,
      socket: {
        open(socket) {
          socket.write(`GET /ws HTTP/1.1\r\nHost: localhost:${port}\r\n${headers.join('\r\n')}\r\n\r\n`);
        },
        data(socket, chunk) {
          buf += chunk.toString();
          if (buf.includes('\r\n')) {
            socket.end();
            done();
          }
        },
        error(_socket, err) {
          reject(err);
        },
        close: done,
      },
    }).catch(reject);
  });
}

const WS_HANDSHAKE = ['Connection: Upgrade', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version: 13'];

beforeAll(async () => {
  outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-sec-integration-'));
  assetRoot = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-sec-assets-'));
  mkdirSync(path.join(assetRoot, 'public'));
  mkdirSync(path.join(assetRoot, 'static'));
  writeFileSync(path.join(assetRoot, 'public', 'note.txt'), 'public note');
  writeFileSync(path.join(assetRoot, 'static', 'hello.txt'), 'static hello');

  server = await Mochi.serve({
    port: 0,
    development: false,
    proxy: { hostHeader: 'host' },
    logger: { enabled: false },
    outDir,

    publicDir: path.join(assetRoot, 'public'),
    staticDirs: { '/static': path.join(assetRoot, 'static') },
    csrf: { trustedOrigins: ['https://csrf-only.example'] },
    redirect: { trustedOrigins: ['https://redirect-ok.example'] },
    routes: {
      '/set': Mochi.api(() => {
        getRequestContext().cookies.set('session', 'abc');
        return new Response('ok');
      }),
      '/api/ok': Mochi.api(() => new Response('ok')),
      '/sse/tick': Mochi.sse((stream) => {
        stream.send('tick');
        stream.close();
      }),
      '/ws': Mochi.ws({ message: () => {} }),
      '/plain': Mochi.page(FIXTURE_PAGE),
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
          evil: () => redirect(303, 'https://evil.example/phish'),
          redirectAllowed: () => redirect(303, 'https://redirect-ok.example/next'),
          csrfTrusted: () => redirect(303, 'https://csrf-only.example/next'),
          external: () => redirect(303, 'https://anywhere.example/sso', { external: true }),
          externalInjection: () => redirect(303, 'https://anywhere.example/sso\r\nX-Injected: 1', { external: true }),
        },
      }),
    },
  });
  port = server.port!;
  base = `http://localhost:${port}`;
});

afterAll(() => {
  server.stop(true);
  rmSync(outDir, { recursive: true, force: true });
  rmSync(assetRoot, { recursive: true, force: true });
});

describe('secureCookies (production)', () => {
  test('cookie is HttpOnly, SameSite=Lax, and Secure', async () => {
    const res = await fetch(`${base}/set`);
    const setCookie = (res.headers.get('set-cookie') ?? '').toLowerCase();
    expect(setCookie).toContain('httponly');
    expect(setCookie).toContain('samesite=lax');
    expect(setCookie).toContain('secure');
  });
});

describe('same-origin redirect guard', () => {
  test('allows a same-origin (relative) redirect', async () => {
    const res = await fetch(`${base}/page?/safe`, {
      method: 'POST',
      headers: { accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded', origin: base },
      body: '',
      redirect: 'manual',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/ok');
  });

  test('blocks an off-origin redirect with 500', async () => {
    const res = await fetch(`${base}/page?/evil`, {
      method: 'POST',
      headers: { accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded', origin: base },
      body: '',
      redirect: 'manual',
    });
    expect(res.status).toBe(500);
    expect(res.headers.get('location')).toBeNull();
  });

  test('blocks an off-origin redirect returned from serverProps', async () => {
    const res = await fetch(`${base}/loader-redirect?next=https://evil.example/phish`, { redirect: 'manual' });
    expect(res.headers.get('location')).not.toBe('https://evil.example/phish');
    expect(res.status).toBe(500);
  });

  test('allows a same-origin redirect from serverProps', async () => {
    const res = await fetch(`${base}/loader-redirect?next=/ok`, { redirect: 'manual' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/ok');
  });

  test('redirect.trustedOrigins allows its origins, csrf.trustedOrigins does not', async () => {
    const post = (action: string): Promise<Response> =>
      fetch(`${base}/page?/${action}`, {
        method: 'POST',
        headers: { accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded', origin: base },
        body: '',
        redirect: 'manual',
      });

    const allowed = await post('redirectAllowed');
    expect(allowed.status).toBe(303);
    expect(allowed.headers.get('location')).toBe('https://redirect-ok.example/next');

    // A CSRF-trusted origin is trusted to *send* requests here, not to receive our visitors.
    const csrfOnly = await post('csrfTrusted');
    expect(csrfOnly.status).toBe(500);
    expect(csrfOnly.headers.get('location')).toBeNull();
  });
});

describe('WebSocket origin check', () => {
  test('blocks a cross-origin upgrade', async () => {
    const line = await upgradeStatusLine(port, [...WS_HANDSHAKE, 'Upgrade: websocket', 'Origin: http://evil.example']);
    expect(line).toContain('403');
  });

  test('blocks a cross-origin upgrade that lists more than one Upgrade token', async () => {
    const line = await upgradeStatusLine(port, [...WS_HANDSHAKE, 'Upgrade: websocket, keep-alive', 'Origin: http://evil.example']);
    expect(line).toContain('403');
  });

  test('allows a same-origin upgrade', async () => {
    const line = await upgradeStatusLine(port, [...WS_HANDSHAKE, 'Upgrade: websocket', `Origin: ${base}`]);
    expect(line).toContain('101');
  });
});

describe('default security headers', () => {
  test('API responses carry the baseline headers and no X-Frame-Options', async () => {
    const res = await fetch(`${base}/api/ok`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('x-frame-options')).toBeNull();
  });

  test('page responses carry the baseline headers', async () => {
    const res = await fetch(`${base}/page`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  test('SSE responses carry the baseline headers', async () => {
    const res = await fetch(`${base}/sse/tick`);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    await res.body?.cancel();
  });

  test('publicDir files carry the baseline headers', async () => {
    const res = await fetch(`${base}/note.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('public note');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  test('a CSRF block that falls through to the fetch handler carries the baseline headers', async () => {
    // A page without actions is registered GET-only, so its POST never reaches a route handler.
    const res = await fetch(`${base}/plain`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://evil.example' },
      body: '',
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('per-call external redirect', () => {
  test('redirect({ external: true }) leaves an off-origin location alone', async () => {
    const res = await fetch(`${base}/page?/external`, {
      method: 'POST',
      headers: { accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded', origin: base },
      body: '',
      redirect: 'manual',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://anywhere.example/sso');
  });

  test('works from serverProps too', async () => {
    const res = await fetch(`${base}/loader-external`, { redirect: 'manual' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://anywhere.example/sso');
  });

  test('still rejects a location carrying control characters', async () => {
    const res = await fetch(`${base}/page?/externalInjection`, {
      method: 'POST',
      headers: { accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded', origin: base },
      body: '',
      redirect: 'manual',
    });
    expect(res.status).toBe(500);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-injected')).toBeNull();
  });
});
