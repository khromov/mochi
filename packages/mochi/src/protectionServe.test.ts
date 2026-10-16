import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { mintCaptcha, solveCaptcha } from './captcha/captcha';
import { encryptPayload } from './islands/payloadCrypto';
import { PROTECTION_AAD, PROTECTION_CLEARANCE_COOKIE } from './protection/config';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'protection', 'Page.svelte');
const VALIDATING_TEXT = "Please wait, we're validating your browser...";

describe('Mochi.serve({ protection })', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-protection-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      // Resolves the expected CSRF origin from the Host header, so the verify POST below passes with a matching Origin.
      // addressHeader lets the binding tests pose as arbitrary client addresses; header-less fetches fall back to the
      // constant loopback requestIP, so every other test keeps its address (and Bun's constant fetch UA) stable.
      proxy: { hostHeader: 'host', addressHeader: 'x-real-ip' },
      captcha: { bits: 8 },
      publicDir: path.join(import.meta.dir, '__fixtures__', 'protection', 'public'),
      protection: {
        enabled: true,
        protect: ({ path: p }) => !p.startsWith('/open'),
      },
      fetch: () => new Response('user-fetch-handled'),
      routes: {
        '/members': Mochi.page(FIXTURE_PAGE),
        '/open': Mochi.page(FIXTURE_PAGE, { serverProps: { label: 'open' } }),
        '/api/data': Mochi.api(async () => Response.json({ ok: true })),
        '/open-api': Mochi.api(async () => Response.json({ ok: true })),
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

  async function solveAndVerify(
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; body: { ok?: boolean; error?: string }; setCookie: string | null; cacheControl: string | null }> {
    const fields = solveCaptcha(mintCaptcha());
    const form = new FormData();
    form.set('captcha_token', fields.captcha_token);
    form.set('captcha_pow', fields.captcha_pow);
    const res = await fetch(`${base}/_mochi/protection/verify`, {
      method: 'POST',
      body: form,
      headers: { origin: base, ...extraHeaders },
    });
    return {
      status: res.status,
      body: (await res.json()) as { ok?: boolean; error?: string },
      setCookie: res.headers.get('Set-Cookie'),
      cacheControl: res.headers.get('Cache-Control'),
    };
  }

  function clearanceCookieFrom(setCookie: string): string {
    const match = setCookie.match(new RegExp(`${PROTECTION_CLEARANCE_COOKIE}=([^;]+)`));
    expect(match).not.toBeNull();
    return `${PROTECTION_CLEARANCE_COOKIE}=${match![1]}`;
  }

  test('a protected page returns the 403 interstitial', async () => {
    const res = await fetch(`${base}/members`);
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Vary')).toContain('Cookie');
    const html = await res.text();
    expect(html).toContain(VALIDATING_TEXT);
    expect(html).not.toContain('data-testid="protected-page"');
  });

  test('the interstitial carries a hydratable auto-captcha island and a loadable bootstrap', async () => {
    const html = await (await fetch(`${base}/members`)).text();
    expect(html).toContain('mochi-hydratable-island');
    expect(html).toContain('/_mochi/protection/verify');
    const match = html.match(/src="(\/_mochi\/client\/[^"]+\.js)"/);
    expect(match).not.toBeNull();
    const asset = await fetch(`${base}${match![1]}`);
    expect(asset.status).toBe(200);
  });

  test('an unprotected route answers normally with no clearance', async () => {
    const page = await fetch(`${base}/open`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('cleared: open');
    const api = await fetch(`${base}/open-api`);
    expect(api.status).toBe(200);
  });

  test('a protected api route returns JSON 403', async () => {
    const res = await fetch(`${base}/api/data`);
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(((await res.json()) as { error: string }).error).toContain('verification');
  });

  test('protected sse and ws routes return plain 403', async () => {
    const sse = await fetch(`${base}/sse`);
    expect(sse.status).toBe(403);
    const ws = await fetch(`${base}/ws`);
    expect(ws.status).toBe(403);
  });

  test('publicDir static files are gated by default (protectFiles) and open with clearance', async () => {
    const blocked = await fetch(`${base}/hello.txt`);
    expect(blocked.status).toBe(403);

    const verified = await solveAndVerify();
    const cookie = clearanceCookieFrom(verified.setCookie!);
    const served = await fetch(`${base}/hello.txt`, { headers: { cookie } });
    expect(served.status).toBe(200);
    expect(await served.text()).toContain('hello from publicDir');
    // The gate read the clearance cookie, so a shared cache must not replay this copy to unverified visitors.
    expect(served.headers.get('Vary')).toContain('Cookie');
  });

  test('a POST to a protected page gets JSON 403, not the interstitial', async () => {
    const form = new FormData();
    form.set('name', 'x');
    const res = await fetch(`${base}/members`, { method: 'POST', body: form, headers: { origin: base } });
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  test('a token minted at lower difficulty cannot be redeemed for clearance', async () => {
    const weak = solveCaptcha(mintCaptcha({ bits: 4 }));
    const form = new FormData();
    form.set('captcha_token', weak.captcha_token);
    form.set('captcha_pow', weak.captcha_pow);
    const res = await fetch(`${base}/_mochi/protection/verify`, { method: 'POST', body: form, headers: { origin: base } });
    expect(res.status).toBe(403);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  test('an unmatched URL behind userFetch is protected too', async () => {
    const res = await fetch(`${base}/no-such-route`);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain(VALIDATING_TEXT);
  });

  test('a solved captcha redeems for a clearance cookie that opens every protected kind', async () => {
    const verified = await solveAndVerify();
    expect(verified.status).toBe(200);
    expect(verified.body.ok).toBe(true);
    expect(verified.setCookie).not.toBeNull();
    expect(verified.setCookie).toContain(PROTECTION_CLEARANCE_COOKIE);
    expect(verified.setCookie).toContain('HttpOnly');
    expect(verified.setCookie!.toLowerCase()).toContain('samesite=lax');
    expect(verified.setCookie).toContain('Max-Age=14400');
    // The response carries a credential, so it must never be stored.
    expect(verified.cacheControl).toBe('no-store');

    const cookie = clearanceCookieFrom(verified.setCookie!);
    const page = await fetch(`${base}/members`, { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('data-testid="protected-page"');

    const api = await fetch(`${base}/api/data`, { headers: { cookie } });
    expect(api.status).toBe(200);

    const fallback = await fetch(`${base}/no-such-route`, { headers: { cookie } });
    expect(fallback.status).toBe(200);
    expect(await fallback.text()).toBe('user-fetch-handled');
  });

  test('a solved captcha cannot be redeemed twice', async () => {
    const fields = solveCaptcha(mintCaptcha());
    const post = async () => {
      const form = new FormData();
      form.set('captcha_token', fields.captcha_token);
      form.set('captcha_pow', fields.captcha_pow);
      return fetch(`${base}/_mochi/protection/verify`, { method: 'POST', body: form, headers: { origin: base } });
    };
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(403);
  });

  test('a garbage solution is refused', async () => {
    const form = new FormData();
    form.set('captcha_token', 'not-a-token');
    form.set('captcha_pow', '0');
    const res = await fetch(`${base}/_mochi/protection/verify`, { method: 'POST', body: form, headers: { origin: base } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
  });

  test('GET on the verify endpoint is refused', async () => {
    const res = await fetch(`${base}/_mochi/protection/verify`);
    expect(res.status).toBe(405);
  });

  test('an expired clearance is challenged again', async () => {
    const stale = encryptPayload(JSON.stringify({ iat: Date.now() - 15_000_000, bits: 8 }), { aad: PROTECTION_AAD });
    const res = await fetch(`${base}/members`, { headers: { cookie: `${PROTECTION_CLEARANCE_COOKIE}=${stale}` } });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain(VALIDATING_TEXT);
  });

  test('a tampered clearance is challenged again', async () => {
    const res = await fetch(`${base}/members`, { headers: { cookie: `${PROTECTION_CLEARANCE_COOKIE}=garbage` } });
    expect(res.status).toBe(403);
  });

  test('blocked and cleared responses vary on the bound headers', async () => {
    const blocked = await fetch(`${base}/members`);
    const blockedVary = blocked.headers.get('Vary') ?? '';
    expect(blockedVary).toContain('Cookie');
    expect(blockedVary).toContain('user-agent');
    expect(blockedVary).toContain('accept-language');

    const verified = await solveAndVerify();
    const cookie = clearanceCookieFrom(verified.setCookie!);
    const cleared = await fetch(`${base}/members`, { headers: { cookie } });
    expect(cleared.status).toBe(200);
    expect(cleared.headers.get('Vary') ?? '').toContain('user-agent');
  });

  test('a clearance is bound to the key headers: a different User-Agent re-challenges', async () => {
    const verified = await solveAndVerify({ 'user-agent': 'BoundBrowser/1.0' });
    const cookie = clearanceCookieFrom(verified.setCookie!);
    expect((await fetch(`${base}/members`, { headers: { cookie, 'user-agent': 'BoundBrowser/1.0' } })).status).toBe(200);
    const other = await fetch(`${base}/members`, { headers: { cookie, 'user-agent': 'OtherAgent/2.0' } });
    expect(other.status).toBe(403);
    expect(await other.text()).toContain(VALIDATING_TEXT);
  });

  test('a clearance is bound to the /24: a neighbor passes, another network re-challenges', async () => {
    const verified = await solveAndVerify({ 'x-real-ip': '203.0.113.7' });
    const cookie = clearanceCookieFrom(verified.setCookie!);
    expect((await fetch(`${base}/members`, { headers: { cookie, 'x-real-ip': '203.0.113.99' } })).status).toBe(200);
    expect((await fetch(`${base}/members`, { headers: { cookie, 'x-real-ip': '198.51.100.1' } })).status).toBe(403);
  });

  test('a v4-bound clearance presented over IPv6 passes once and is re-minted bound to the v6 prefix', async () => {
    const verified = await solveAndVerify({ 'x-real-ip': '203.0.113.7' });
    const cookie = clearanceCookieFrom(verified.setCookie!);

    const flipped = await fetch(`${base}/members`, { headers: { cookie, 'x-real-ip': '2001:db8:1:2::1' } });
    expect(flipped.status).toBe(200);
    const remintHeader = flipped.headers.get('Set-Cookie');
    expect(remintHeader).toContain(PROTECTION_CLEARANCE_COOKIE);

    const remint = clearanceCookieFrom(remintHeader!);
    expect((await fetch(`${base}/members`, { headers: { cookie: remint, 'x-real-ip': '2001:db8:1:2:ffff::9' } })).status).toBe(200);
    // The flip is one-directional and one-time: another /64 gets no second allowance.
    expect((await fetch(`${base}/members`, { headers: { cookie: remint, 'x-real-ip': '2001:db8:9:9::1' } })).status).toBe(403);
  });

  test('an unbound clearance is re-challenged now that binding is the default', async () => {
    const unbound = encryptPayload(JSON.stringify({ iat: Date.now(), bits: 8, n: 'x' }), { aad: PROTECTION_AAD });
    const res = await fetch(`${base}/members`, { headers: { cookie: `${PROTECTION_CLEARANCE_COOKIE}=${unbound}` } });
    expect(res.status).toBe(403);
  });
});
