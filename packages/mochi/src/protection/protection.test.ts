import { afterEach, describe, expect, test } from 'bun:test';
import type { Server } from 'bun';
import {
  resolveProtectionOptions,
  protectionBootWarnings,
  DEFAULT_PROTECTION_MAX_AGE_MS,
  DEFAULT_PROTECTION_MAX_ATTEMPTS,
  PROTECTION_AAD,
  PROTECTION_CLEARANCE_COOKIE,
} from './config';
import { mintClearanceToken, checkClearance } from './clearance';
import { createProtectionRuntime, type ProtectionGateInput } from './gate';
import type { MochiProtectionKind, ResolvedProtectionOptions } from './types';
import { encryptPayload } from '../islands/payloadCrypto';
import { MochiCookieJar } from '../runtime/cookies';
import { computeBindHashes, resolveBindOptions, DEFAULT_BIND_HEADERS, type ResolvedBindOptions } from '../runtime/clientBind';
import type { ComponentRegistry } from '../compiler/ComponentRegistry';

const GLOBAL_CONFIG_KEY = '__mochi_config__';

function installConfig() {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY] = {
    options: {},
    secretKey: Buffer.from('test-key-for-unit-tests-32bytes!'),
  };
}

const NO_BIND: ResolvedBindOptions = { network: false, headers: [] };
const FULL_BIND = resolveBindOptions(true, true, 'Protection');

function hasValidClearance(cookieValue: string | undefined, maxAgeMs: number, minBits: number): boolean {
  return checkClearance(cookieValue, { maxAgeMs, minBits, bind: NO_BIND, current: null }).ok;
}

function bindFor(address: string | null, headers: Record<string, string> = {}, bind: ResolvedBindOptions = FULL_BIND) {
  return computeBindHashes({ address, headers: new Headers(headers) }, bind);
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY];
});

describe('resolveProtectionOptions', () => {
  test('applies defaults', () => {
    const resolved = resolveProtectionOptions({ enabled: true }, 19);
    expect(resolved.bits).toBe(19);
    expect(resolved.maxAgeMs).toBe(DEFAULT_PROTECTION_MAX_AGE_MS);
    expect(resolved.protect).toBeUndefined();
    expect(resolved.page).toBeUndefined();
    expect(resolved.blockedMessage).toBeUndefined();
    expect(resolved.protectFiles).toBe(true);
    expect(resolved.maxAttempts).toBe(DEFAULT_PROTECTION_MAX_ATTEMPTS);
    expect(resolved.cookieName).toBe(PROTECTION_CLEARANCE_COOKIE);
  });

  test('rejects a non-positive or fractional maxAttempts', () => {
    expect(() => resolveProtectionOptions({ enabled: true, maxAttempts: 0 }, 19)).toThrow('maxAttempts must be a positive integer, got 0');
    expect(() => resolveProtectionOptions({ enabled: true, maxAttempts: 2.5 }, 19)).toThrow('maxAttempts must be a positive integer');
  });

  test('rejects an invalid cookieName', () => {
    expect(() => resolveProtectionOptions({ enabled: true, cookieName: '' }, 19)).toThrow('cookieName must be a valid cookie name');
    expect(() => resolveProtectionOptions({ enabled: true, cookieName: 'has spaces' }, 19)).toThrow('cookieName must be a valid cookie name');
    expect(() => resolveProtectionOptions({ enabled: true, cookieName: 'semi;colon' }, 19)).toThrow('cookieName must be a valid cookie name');
    expect(resolveProtectionOptions({ enabled: true, cookieName: 'my-clearance' }, 19).cookieName).toBe('my-clearance');
  });

  test('own bits win over the captcha fallback', () => {
    expect(resolveProtectionOptions({ enabled: true, bits: 10 }, 19).bits).toBe(10);
  });

  test('rejects out-of-range bits', () => {
    expect(() => resolveProtectionOptions({ enabled: true, bits: 0 }, 19)).toThrow('bits must be an integer between 1 and 32, got 0');
    expect(() => resolveProtectionOptions({ enabled: true, bits: 33 }, 19)).toThrow('bits must be an integer between 1 and 32, got 33');
    expect(() => resolveProtectionOptions({ enabled: true, bits: 8.5 }, 19)).toThrow('bits must be an integer');
  });

  test('rejects a non-positive maxAgeMs', () => {
    expect(() => resolveProtectionOptions({ enabled: true, maxAgeMs: 0 }, 19)).toThrow('maxAgeMs must be a positive finite number, got 0');
    expect(() => resolveProtectionOptions({ enabled: true, maxAgeMs: Infinity }, 19)).toThrow('maxAgeMs must be a positive finite number, got Infinity');
  });

  test('rejects a non-function protect', () => {
    expect(() => resolveProtectionOptions({ enabled: true, protect: true as unknown as () => boolean }, 19)).toThrow('protect must be a function');
  });

  test('bind defaults to network plus the default headers', () => {
    expect(resolveProtectionOptions({ enabled: true }, 19).bind).toEqual({ network: true, headers: [...DEFAULT_BIND_HEADERS] });
  });

  test('bind: false disables binding entirely', () => {
    expect(resolveProtectionOptions({ enabled: true, bind: false }, 19).bind).toEqual({ network: false, headers: [] });
  });

  test('a bind object is normalized: lowercased, deduped, sorted headers', () => {
    const resolved = resolveProtectionOptions({ enabled: true, bind: { network: false, headers: ['User-Agent', 'Accept', 'user-agent'] } }, 19);
    expect(resolved.bind).toEqual({ network: false, headers: ['accept', 'user-agent'] });
  });

  test('rejects invalid bind header names', () => {
    expect(() => resolveProtectionOptions({ enabled: true, bind: { headers: ['has space'] } }, 19)).toThrow('invalid header name');
    expect(() => resolveProtectionOptions({ enabled: true, bind: { headers: [''] } }, 19)).toThrow('invalid header name');
  });
});

describe('protectionBootWarnings', () => {
  const originalKey = process.env.MOCHI_KEY;
  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.MOCHI_KEY;
    } else {
      process.env.MOCHI_KEY = originalKey;
    }
  });

  test('warns about a per-boot key and a missing trusted origin', () => {
    delete process.env.MOCHI_KEY;
    const warnings = protectionBootWarnings({});
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('MOCHI_KEY');
    expect(warnings[1]).toContain('proxy.origin');
  });

  test('a set MOCHI_KEY silences the key warning', () => {
    process.env.MOCHI_KEY = 'x';
    expect(protectionBootWarnings({ proxy: { origin: 'https://example.com' } })).toHaveLength(0);
  });

  test('the CSRF warning is silenced by proxy.hostHeader, checkOrigin: false, or a csrf:check filter', () => {
    process.env.MOCHI_KEY = 'x';
    expect(protectionBootWarnings({ proxy: { hostHeader: 'x-forwarded-host' } })).toHaveLength(0);
    expect(protectionBootWarnings({ csrf: { checkOrigin: false } })).toHaveLength(0);
    expect(protectionBootWarnings({ filters: { 'csrf:check': () => null } })).toHaveLength(0);
  });
});

describe('clearance tokens', () => {
  test('a freshly minted clearance validates', () => {
    installConfig();
    expect(hasValidClearance(mintClearanceToken({ bits: 19, bind: null }), DEFAULT_PROTECTION_MAX_AGE_MS, 19)).toBe(true);
  });

  test('an expired clearance is refused', () => {
    installConfig();
    const stale = encryptPayload(JSON.stringify({ iat: Date.now() - 10_000, bits: 19, n: 'x' }), { aad: PROTECTION_AAD });
    expect(hasValidClearance(stale, 5_000, 19)).toBe(false);
  });

  test('a clearance from beyond the drift allowance in the future is refused', () => {
    installConfig();
    const future = encryptPayload(JSON.stringify({ iat: Date.now() + 60_000, bits: 19, n: 'x' }), { aad: PROTECTION_AAD });
    expect(hasValidClearance(future, DEFAULT_PROTECTION_MAX_AGE_MS, 19)).toBe(false);
  });

  test('a slightly-future clearance from a fast-clocked instance is accepted', () => {
    installConfig();
    const skewed = encryptPayload(JSON.stringify({ iat: Date.now() + 10_000, bits: 19, n: 'x' }), { aad: PROTECTION_AAD });
    expect(hasValidClearance(skewed, DEFAULT_PROTECTION_MAX_AGE_MS, 19)).toBe(true);
  });

  test('a clearance minted below the currently required bits is refused', () => {
    installConfig();
    // Raising the difficulty re-challenges holders of cheaper clearances instead of honoring them until expiry.
    expect(hasValidClearance(mintClearanceToken({ bits: 10, bind: null }), DEFAULT_PROTECTION_MAX_AGE_MS, 19)).toBe(false);
    expect(hasValidClearance(mintClearanceToken({ bits: 20, bind: null }), DEFAULT_PROTECTION_MAX_AGE_MS, 19)).toBe(true);
  });

  test('a tampered clearance is refused', () => {
    installConfig();
    const token = mintClearanceToken({ bits: 19, bind: null });
    const flipped = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    expect(hasValidClearance(flipped, DEFAULT_PROTECTION_MAX_AGE_MS, 19)).toBe(false);
  });

  test('a pre-binding clearance (no nonce) is refused without crashing', () => {
    installConfig();
    const legacy = encryptPayload(JSON.stringify({ iat: Date.now(), bits: 19 }), { aad: PROTECTION_AAD });
    expect(hasValidClearance(legacy, DEFAULT_PROTECTION_MAX_AGE_MS, 19)).toBe(false);
  });

  test('two clearances with identical inputs differ byte-wise', () => {
    installConfig();
    // AES-SIV is deterministic, so without the random nonce equal payloads would be equal ciphertexts.
    expect(mintClearanceToken({ bits: 19, iat: 1234, bind: null })).not.toBe(mintClearanceToken({ bits: 19, iat: 1234, bind: null }));
  });

  test('a captcha challenge token is not a clearance', () => {
    installConfig();
    const captchaToken = encryptPayload(JSON.stringify({ iat: Date.now(), nonce: crypto.randomUUID(), bits: 19 }), { aad: 'mochi-captcha' });
    expect(hasValidClearance(captchaToken, DEFAULT_PROTECTION_MAX_AGE_MS, 19)).toBe(false);
  });

  test('missing, empty, and garbage cookie values are refused', () => {
    installConfig();
    expect(hasValidClearance(undefined, DEFAULT_PROTECTION_MAX_AGE_MS, 19)).toBe(false);
    expect(hasValidClearance('', DEFAULT_PROTECTION_MAX_AGE_MS, 19)).toBe(false);
    expect(hasValidClearance('not-a-token', DEFAULT_PROTECTION_MAX_AGE_MS, 19)).toBe(false);
  });

  test('a sealed non-object payload is refused', () => {
    installConfig();
    expect(hasValidClearance(encryptPayload('"just a string"', { aad: PROTECTION_AAD }), DEFAULT_PROTECTION_MAX_AGE_MS, 19)).toBe(false);
  });
});

describe('client-bound clearances', () => {
  const UA = { 'user-agent': 'TestBrowser/1.0', 'accept-language': 'en-US' };
  const check = (token: string, current: ReturnType<typeof bindFor>, bind: ResolvedBindOptions = FULL_BIND) =>
    checkClearance(token, { maxAgeMs: DEFAULT_PROTECTION_MAX_AGE_MS, minBits: 19, bind, current });

  test('a clearance bound to the minting request validates against a matching request', () => {
    installConfig();
    const token = mintClearanceToken({ bits: 19, bind: bindFor('203.0.113.7', UA) });
    expect(check(token, bindFor('203.0.113.7', UA))).toMatchObject({ ok: true, familyFlip: false });
  });

  test('another address in the same /24 still validates; another /24 does not', () => {
    installConfig();
    const token = mintClearanceToken({ bits: 19, bind: bindFor('203.0.113.7', UA) });
    expect(check(token, bindFor('203.0.113.200', UA)).ok).toBe(true);
    expect(check(token, bindFor('203.0.114.7', UA)).ok).toBe(false);
  });

  test('the same /64 validates; another /64 does not', () => {
    installConfig();
    const token = mintClearanceToken({ bits: 19, bind: bindFor('2001:db8:1:2::1', UA) });
    expect(check(token, bindFor('2001:db8:1:2:ffff::9', UA)).ok).toBe(true);
    expect(check(token, bindFor('2001:db8:1:3::1', UA)).ok).toBe(false);
  });

  test('a changed bound header re-challenges', () => {
    installConfig();
    const token = mintClearanceToken({ bits: 19, bind: bindFor('203.0.113.7', UA) });
    expect(check(token, bindFor('203.0.113.7', { ...UA, 'user-agent': 'OtherAgent/2.0' })).ok).toBe(false);
  });

  test('a v4-bound clearance presented over IPv6 passes as a family flip', () => {
    installConfig();
    const token = mintClearanceToken({ bits: 19, bind: bindFor('203.0.113.7', UA) });
    expect(check(token, bindFor('2001:db8::1', UA))).toMatchObject({ ok: true, familyFlip: true });
  });

  test('the flip is one-directional: a v6-bound clearance presented over IPv4 is refused', () => {
    installConfig();
    const token = mintClearanceToken({ bits: 19, bind: bindFor('2001:db8::1', UA) });
    expect(check(token, bindFor('203.0.113.7', UA)).ok).toBe(false);
  });

  test('a family flip with a changed bound header is still refused', () => {
    installConfig();
    const token = mintClearanceToken({ bits: 19, bind: bindFor('203.0.113.7', UA) });
    expect(check(token, bindFor('2001:db8::1', { ...UA, 'user-agent': 'OtherAgent/2.0' })).ok).toBe(false);
  });

  test('an unbound clearance is refused once binding is active', () => {
    installConfig();
    const token = mintClearanceToken({ bits: 19, bind: null });
    expect(check(token, bindFor('203.0.113.7', UA)).ok).toBe(false);
  });

  test('a v4-mapped IPv6 address binds identically to its IPv4 form', () => {
    installConfig();
    const token = mintClearanceToken({ bits: 19, bind: bindFor('203.0.113.7', UA) });
    expect(check(token, bindFor('::ffff:203.0.113.42', UA))).toMatchObject({ ok: true, familyFlip: false });
  });

  test('header-only binding ignores the address', () => {
    installConfig();
    const headersOnly = resolveBindOptions({ network: false }, true, 'Protection');
    const token = mintClearanceToken({ bits: 19, bind: bindFor('203.0.113.7', UA, headersOnly) });
    expect(check(token, bindFor('198.51.100.9', UA, headersOnly), headersOnly).ok).toBe(true);
    expect(check(token, bindFor('203.0.113.7', { ...UA, 'user-agent': 'OtherAgent/2.0' }, headersOnly), headersOnly).ok).toBe(false);
  });

  test('no resolvable address at mint and check still round-trips', () => {
    installConfig();
    const token = mintClearanceToken({ bits: 19, bind: bindFor(null, UA) });
    expect(check(token, bindFor(null, UA))).toMatchObject({ ok: true, familyFlip: false });
    expect(check(token, bindFor('203.0.113.7', UA)).ok).toBe(false);
  });
});

describe('protection gate', () => {
  const renderedPaths: string[] = [];
  const renderedProps: Record<string, unknown>[] = [];
  const fakeRegistry = {
    renderComponent: async (path: string, props: Record<string, unknown>) => {
      renderedPaths.push(path);
      renderedProps.push(props);
      return {
        body: `<div data-interstitial data-bits="${props.bits}"></div>`,
        head: '',
        cssUrls: [],
        fontPreloadUrls: [],
        bootstrapUrl: null,
        hasServerIslands: false,
      };
    },
  } as unknown as ComponentRegistry;

  function makeRuntime(overrides: Partial<ResolvedProtectionOptions> = {}, trailingSlashPolicy?: 'always' | 'never') {
    return createProtectionRuntime({
      options: { enabled: true, bits: 8, maxAgeMs: 60_000, protectFiles: true, maxAttempts: 5, cookieName: PROTECTION_CLEARANCE_COOKIE, bind: NO_BIND, ...overrides },
      registry: fakeRegistry,
      renderShell: (result) => `<html>${result.body}</html>`,
      assetPrefix: '/_mochi',
      newRequestId: () => 'test-request-id',
      proxy: undefined,
      trailingSlashPolicy,
    });
  }

  function input(kind: MochiProtectionKind, path: string, cookieHeader?: string, client?: { headers?: Record<string, string>; ip?: string }): ProtectionGateInput {
    const url = new URL(`http://localhost:3000${path}`);
    return {
      request: new Request(url, { headers: client?.headers }),
      url,
      kind,
      cookies: new MochiCookieJar(cookieHeader ?? null, {}),
      server: { requestIP: () => (client?.ip ? { address: client.ip } : null) } as unknown as Server<undefined>,
    };
  }

  test('a page without clearance gets the 403 interstitial with no-store and Vary: Cookie', async () => {
    installConfig();
    const { gate } = makeRuntime();
    const blocked = await gate(input('page', '/members/'));
    expect(blocked).toBeDefined();
    expect(blocked!.status).toBe(403);
    expect(blocked!.headers.get('Content-Type')).toContain('text/html');
    expect(blocked!.headers.get('Cache-Control')).toBe('no-store');
    expect(blocked!.headers.get('Vary')).toContain('Cookie');
    expect(await blocked!.text()).toContain('data-interstitial');
  });

  test('the interstitial mints at the configured protection bits', async () => {
    installConfig();
    const { gate } = makeRuntime({ bits: 5 });
    const blocked = await gate(input('page', '/'));
    expect(await blocked!.text()).toContain('data-bits="5"');
  });

  test('an api request without clearance gets JSON 403', async () => {
    installConfig();
    const { gate } = makeRuntime();
    const blocked = await gate(input('api', '/api/data'));
    expect(blocked!.status).toBe(403);
    expect(blocked!.headers.get('Content-Type')).toContain('application/json');
    expect(await blocked!.json()).toMatchObject({ error: expect.stringContaining('verification') });
  });

  test('ws, sse, island, and file get a plain 403', async () => {
    installConfig();
    const { gate } = makeRuntime();
    for (const kind of ['ws', 'sse', 'island', 'file'] as const) {
      const blocked = await gate(input(kind, '/x'));
      expect(blocked!.status).toBe(403);
      expect(blocked!.headers.get('Content-Type') ?? '').not.toContain('text/html');
    }
  });

  test('a non-GET page request gets JSON 403 instead of the interstitial', async () => {
    installConfig();
    const { gate } = makeRuntime();
    const url = new URL('http://localhost:3000/members/');
    const blocked = await gate({
      request: new Request(url, { method: 'POST' }),
      url,
      kind: 'page',
      cookies: new MochiCookieJar(null, {}),
      server: { requestIP: () => null } as unknown as Server<undefined>,
    });
    expect(blocked!.status).toBe(403);
    expect(blocked!.headers.get('Content-Type')).toContain('application/json');
    // Solving an interstitial served on a POST would end in a reload that re-submits the form.
    expect(await blocked!.text()).not.toContain('data-interstitial');
  });

  test('a fallback request gets the interstitial', async () => {
    installConfig();
    const { gate } = makeRuntime();
    const blocked = await gate(input('fallback', '/anything'));
    expect(blocked!.status).toBe(403);
    expect(blocked!.headers.get('Content-Type')).toContain('text/html');
  });

  test('a valid clearance cookie passes', async () => {
    installConfig();
    const { gate } = makeRuntime();
    const cookie = `${PROTECTION_CLEARANCE_COOKIE}=${mintClearanceToken({ bits: 8, bind: null })}`;
    expect(await gate(input('page', '/members/', cookie))).toBeUndefined();
    expect(await gate(input('api', '/api/data', cookie))).toBeUndefined();
  });

  test('an expired clearance is re-challenged', async () => {
    installConfig();
    const { gate } = makeRuntime({ maxAgeMs: 5_000 });
    const stale = encryptPayload(JSON.stringify({ iat: Date.now() - 10_000, bits: 8, n: 'x' }), { aad: PROTECTION_AAD });
    const blocked = await gate(input('page', '/members/', `${PROTECTION_CLEARANCE_COOKIE}=${stale}`));
    expect(blocked!.status).toBe(403);
  });

  test('the verify endpoint is never gated, either slash variant', async () => {
    installConfig();
    const { gate } = makeRuntime();
    expect(await gate(input('api', '/_mochi/protection/verify'))).toBeUndefined();
    expect(await gate(input('api', '/_mochi/protection/verify/'))).toBeUndefined();
  });

  test('without protect() every route is protected', async () => {
    installConfig();
    const { gate } = makeRuntime();
    for (const kind of ['page', 'api', 'ws', 'sse', 'island', 'file', 'fallback'] as const) {
      expect(await gate(input(kind, '/x'))).toBeDefined();
    }
  });

  test('protect() selects what is gated and receives the request context', async () => {
    installConfig();
    const seen: Array<{ kind: string; path: string }> = [];
    const { gate } = makeRuntime({
      protect: (ctx) => {
        seen.push({ kind: ctx.kind, path: ctx.path });
        return ctx.kind === 'api';
      },
    });
    expect(await gate(input('page', '/members/'))).toBeUndefined();
    expect(await gate(input('api', '/api/data'))).toBeDefined();
    expect(seen).toEqual([
      { kind: 'page', path: '/members/' },
      { kind: 'api', path: '/api/data' },
    ]);
  });

  test('a throwing protect() fails closed', async () => {
    installConfig();
    const { gate } = makeRuntime({
      protect: () => {
        throw new Error('boom');
      },
    });
    const blocked = await gate(input('page', '/'));
    expect(blocked!.status).toBe(403);
  });

  test('the interstitial props carry maxAttempts', async () => {
    installConfig();
    renderedProps.length = 0;
    await makeRuntime({ maxAttempts: 3 }).gate(input('page', '/'));
    expect(renderedProps[0]).toMatchObject({ maxAttempts: 3, verifyUrl: '/_mochi/protection/verify' });
  });

  test('blockedMessage replaces the default 403 body for api and plain kinds', async () => {
    installConfig();
    const { gate } = makeRuntime({ blockedMessage: 'Members only' });
    expect(await (await gate(input('api', '/api/x')))!.json()).toMatchObject({ error: 'Members only' });
    expect(await (await gate(input('sse', '/events')))!.text()).toBe('Members only');
  });

  test('a blockedMessage callback receives the request context', async () => {
    installConfig();
    const { gate } = makeRuntime({ blockedMessage: (ctx) => `${ctx.kind}:${ctx.path}` });
    expect(await (await gate(input('api', '/api/x')))!.json()).toMatchObject({ error: 'api:/api/x' });
  });

  test('a throwing blockedMessage callback falls back to the default', async () => {
    installConfig();
    const { gate } = makeRuntime({
      blockedMessage: () => {
        throw new Error('boom');
      },
    });
    expect(await (await gate(input('api', '/api/x')))!.json()).toMatchObject({ error: 'Browser verification required' });
  });

  test('a custom cookieName is the one checked for clearance', async () => {
    installConfig();
    const { gate } = makeRuntime({ cookieName: 'my-clearance' });
    const token = mintClearanceToken({ bits: 8, bind: null });
    expect(await gate(input('page', '/', `my-clearance=${token}`))).toBeUndefined();
    // The same clearance under the default name no longer counts.
    expect(await gate(input('page', '/', `${PROTECTION_CLEARANCE_COOKIE}=${token}`))).toBeDefined();
  });

  test('renders the built-in interstitial by default and a custom protection.page when set', async () => {
    installConfig();
    renderedPaths.length = 0;
    await makeRuntime().gate(input('page', '/'));
    expect(renderedPaths[0]).toContain('ProtectionShell.svelte');
    renderedPaths.length = 0;
    await makeRuntime({ page: './src/MyShell.svelte' }).gate(input('page', '/'));
    expect(renderedPaths[0]).toBe('./src/MyShell.svelte');
  });

  test('verifyUrl follows the trailingSlash policy', () => {
    expect(makeRuntime({}).verifyUrl).toBe('/_mochi/protection/verify');
    expect(makeRuntime({}, 'always').verifyUrl).toBe('/_mochi/protection/verify/');
    expect(makeRuntime({}, 'never').verifyUrl).toBe('/_mochi/protection/verify');
  });

  describe('with client binding', () => {
    const UA = { 'user-agent': 'TestBrowser/1.0', 'accept-language': 'en-US' };

    function boundCookie(address: string | null, headers: Record<string, string> = UA): string {
      return `${PROTECTION_CLEARANCE_COOKIE}=${mintClearanceToken({ bits: 8, bind: bindFor(address, headers) })}`;
    }

    test('blocked responses vary on the bound headers as well as Cookie', async () => {
      installConfig();
      const { gate } = makeRuntime({ bind: FULL_BIND });
      const blocked = await gate(input('page', '/members/', undefined, { headers: UA, ip: '203.0.113.7' }));
      const vary = blocked!.headers.get('Vary') ?? '';
      expect(vary).toContain('Cookie');
      expect(vary).toContain('user-agent');
      expect(vary).toContain('accept-language');
    });

    test('a bound clearance passes from the binding client and re-challenges elsewhere', async () => {
      installConfig();
      const { gate } = makeRuntime({ bind: FULL_BIND });
      const cookie = boundCookie('203.0.113.7');
      expect(await gate(input('page', '/members/', cookie, { headers: UA, ip: '203.0.113.7' }))).toBeUndefined();
      expect(await gate(input('page', '/members/', cookie, { headers: UA, ip: '203.0.113.99' }))).toBeUndefined();
      expect(await gate(input('page', '/members/', cookie, { headers: UA, ip: '198.51.100.1' }))).toBeDefined();
      expect(await gate(input('page', '/members/', cookie, { headers: { ...UA, 'user-agent': 'Other/2.0' }, ip: '203.0.113.7' }))).toBeDefined();
    });

    test('cleared responses vary on the bound headers through the shared jar', async () => {
      installConfig();
      const { gate } = makeRuntime({ bind: FULL_BIND });
      const req = input('page', '/members/', boundCookie('203.0.113.7'), { headers: UA, ip: '203.0.113.7' });
      expect(await gate(req)).toBeUndefined();
      expect(req.cookies.getExtraVary()).toEqual(['accept-language', 'user-agent']);
    });

    test('a family flip passes and re-mints a v6-bound clearance preserving the original lifetime', async () => {
      installConfig();
      const iat = Date.now() - 30_000;
      const cookieValue = mintClearanceToken({ bits: 8, iat, bind: bindFor('203.0.113.7', UA) });
      const { gate } = makeRuntime({ bind: FULL_BIND });
      const req = input('page', '/members/', `${PROTECTION_CLEARANCE_COOKIE}=${cookieValue}`, { headers: UA, ip: '2001:db8::1' });
      expect(await gate(req)).toBeUndefined();
      const setCookie = req.cookies.getSetCookieHeaders().find((h) => h.startsWith(`${PROTECTION_CLEARANCE_COOKIE}=`));
      expect(setCookie).toBeDefined();
      const maxAge = Number(/Max-Age=(\d+)/.exec(setCookie!)?.[1]);
      // 60s maxAgeMs minus the 30s already elapsed — the re-mint must not restart the clock.
      expect(maxAge).toBeLessThanOrEqual(31);
      expect(maxAge).toBeGreaterThanOrEqual(25);
      const reminted = decodeURIComponent(setCookie!.split(';')[0]!.slice(PROTECTION_CLEARANCE_COOKIE.length + 1));
      const check = checkClearance(reminted, { maxAgeMs: 60_000, minBits: 8, bind: FULL_BIND, current: bindFor('2001:db8::1', UA) });
      expect(check).toMatchObject({ ok: true, familyFlip: false, iat });
    });

    test('an unbound clearance is re-challenged once binding is on', async () => {
      installConfig();
      const { gate } = makeRuntime({ bind: FULL_BIND });
      const cookie = `${PROTECTION_CLEARANCE_COOKIE}=${mintClearanceToken({ bits: 8, bind: null })}`;
      expect(await gate(input('page', '/members/', cookie, { headers: UA, ip: '203.0.113.7' }))).toBeDefined();
    });
  });
});
