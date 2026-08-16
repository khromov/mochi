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
      proxy: { hostHeader: 'host' },
      captcha: { bits: 8 },
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

  async function solveAndVerify(): Promise<{ status: number; body: { ok?: boolean; error?: string }; setCookie: string | null }> {
    const fields = solveCaptcha(mintCaptcha());
    const form = new FormData();
    form.set('captcha_token', fields.captcha_token);
    form.set('captcha_pow', fields.captcha_pow);
    const res = await fetch(`${base}/_mochi/protection/verify`, {
      method: 'POST',
      body: form,
      headers: { origin: base },
    });
    return { status: res.status, body: (await res.json()) as { ok?: boolean; error?: string }, setCookie: res.headers.get('Set-Cookie') };
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
});
