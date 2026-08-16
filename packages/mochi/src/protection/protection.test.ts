import { afterEach, describe, expect, test } from 'bun:test';
import type { Server } from 'bun';
import { resolveProtectionOptions, DEFAULT_PROTECTION_MAX_AGE_MS, PROTECTION_AAD, PROTECTION_CLEARANCE_COOKIE } from './config';
import { mintClearanceToken, hasValidClearance } from './clearance';
import { createProtectionRuntime, type ProtectionGateInput } from './gate';
import type { MochiProtectionKind, ResolvedProtectionOptions } from './types';
import { encryptPayload } from '../islands/payloadCrypto';
import { MochiCookieJar } from '../runtime/cookies';
import type { ComponentRegistry } from '../compiler/ComponentRegistry';

const GLOBAL_CONFIG_KEY = '__mochi_config__';

function installConfig() {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY] = {
    options: {},
    secretKey: Buffer.from('test-key-for-unit-tests-32bytes!'),
  };
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
});

describe('clearance tokens', () => {
  test('a freshly minted clearance validates', () => {
    installConfig();
    expect(hasValidClearance(mintClearanceToken(19), DEFAULT_PROTECTION_MAX_AGE_MS)).toBe(true);
  });

  test('an expired clearance is refused', () => {
    installConfig();
    const stale = encryptPayload(JSON.stringify({ iat: Date.now() - 10_000, bits: 19 }), { aad: PROTECTION_AAD });
    expect(hasValidClearance(stale, 5_000)).toBe(false);
  });

  test('a clearance from the future is refused', () => {
    installConfig();
    const future = encryptPayload(JSON.stringify({ iat: Date.now() + 60_000, bits: 19 }), { aad: PROTECTION_AAD });
    expect(hasValidClearance(future, DEFAULT_PROTECTION_MAX_AGE_MS)).toBe(false);
  });

  test('a tampered clearance is refused', () => {
    installConfig();
    const token = mintClearanceToken(19);
    const flipped = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    expect(hasValidClearance(flipped, DEFAULT_PROTECTION_MAX_AGE_MS)).toBe(false);
  });

  test('a captcha challenge token is not a clearance', () => {
    installConfig();
    const captchaToken = encryptPayload(JSON.stringify({ iat: Date.now(), nonce: crypto.randomUUID(), bits: 19 }), { aad: 'mochi-captcha' });
    expect(hasValidClearance(captchaToken, DEFAULT_PROTECTION_MAX_AGE_MS)).toBe(false);
  });

  test('missing, empty, and garbage cookie values are refused', () => {
    installConfig();
    expect(hasValidClearance(undefined, DEFAULT_PROTECTION_MAX_AGE_MS)).toBe(false);
    expect(hasValidClearance('', DEFAULT_PROTECTION_MAX_AGE_MS)).toBe(false);
    expect(hasValidClearance('not-a-token', DEFAULT_PROTECTION_MAX_AGE_MS)).toBe(false);
  });

  test('a sealed non-object payload is refused', () => {
    installConfig();
    expect(hasValidClearance(encryptPayload('"just a string"', { aad: PROTECTION_AAD }), DEFAULT_PROTECTION_MAX_AGE_MS)).toBe(false);
  });
});

describe('protection gate', () => {
  const renderedPaths: string[] = [];
  const fakeRegistry = {
    renderComponent: async (path: string, props: Record<string, unknown>) => {
      renderedPaths.push(path);
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
      options: { enabled: true, bits: 8, maxAgeMs: 60_000, ...overrides },
      registry: fakeRegistry,
      renderShell: (result) => `<html>${result.body}</html>`,
      assetPrefix: '/_mochi',
      newRequestId: () => 'test-request-id',
      proxy: undefined,
      trailingSlashPolicy,
    });
  }

  function input(kind: MochiProtectionKind, path: string, cookieHeader?: string): ProtectionGateInput {
    const url = new URL(`http://localhost:3000${path}`);
    return {
      request: new Request(url),
      url,
      kind,
      cookies: new MochiCookieJar(cookieHeader ?? null, {}),
      server: { requestIP: () => null } as unknown as Server<undefined>,
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
    const cookie = `${PROTECTION_CLEARANCE_COOKIE}=${mintClearanceToken(8)}`;
    expect(await gate(input('page', '/members/', cookie))).toBeUndefined();
    expect(await gate(input('api', '/api/data', cookie))).toBeUndefined();
  });

  test('an expired clearance is re-challenged', async () => {
    installConfig();
    const { gate } = makeRuntime({ maxAgeMs: 5_000 });
    const stale = encryptPayload(JSON.stringify({ iat: Date.now() - 10_000, bits: 8 }), { aad: PROTECTION_AAD });
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
});
