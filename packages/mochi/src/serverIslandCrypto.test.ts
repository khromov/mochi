import { afterEach, describe, expect, test } from 'bun:test';
import { stringify as devalueStringify } from 'devalue';
import { encryptProps, decryptProps } from './serverIslandCrypto';
import { requestContext, type MochiRequestContext } from './requestContext';
import { MochiCookieJar } from './cookies';

const GLOBAL_CONFIG_KEY = '__mochi_config__';

function installConfig() {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY] = {
    options: {},
    secretKey: Buffer.from('test-key-for-unit-tests-32bytes!'),
  };
}

function removeConfig() {
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY];
}

function makeCtx(opts?: { dev?: boolean }): MochiRequestContext {
  return {
    requestId: 'test',
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
    params: {},
    locals: {},
    isWarmup: false,
    cookies: new MochiCookieJar(null),
    islandProps: new Map(),
    debugBarData: opts?.dev ? { route: '/', pathname: '/', params: {}, islandProps: {} } : undefined,
    getClientAddress: () => null,
  };
}

function withCtx<T>(fn: (ctx: MochiRequestContext) => T, opts?: { dev?: boolean }): T {
  const ctx = makeCtx(opts);
  return requestContext.run(ctx, () => fn(ctx));
}

const COMP = 'Counter';

afterEach(() => {
  removeConfig();
});

describe('encryptProps + decryptProps', () => {
  test('round-trips: decrypt returns what encrypt sealed', () => {
    installConfig();
    const json = devalueStringify({ islandId: 'mochi-abc-0', name: 'World' });
    const token = encryptProps(json, COMP);
    expect(decryptProps(token, COMP)).toBe(json);
  });

  test('token is opaque ciphertext, not readable JSON', () => {
    installConfig();
    const json = devalueStringify({ islandId: 'mochi-abc-0', secret: 'do-not-leak' });
    const token = encryptProps(json, COMP);
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    expect(decoded).not.toContain('do-not-leak');
    expect(decoded).not.toContain('islandId');
  });

  test('rejects a tampered token', () => {
    installConfig();
    const json = devalueStringify({ islandId: 'mochi-abc-0' });
    const token = encryptProps(json, COMP);
    const mid = Math.floor(token.length / 2);
    const tampered = token.slice(0, mid) + (token[mid] === 'A' ? 'B' : 'A') + token.slice(mid + 1);
    expect(decryptProps(tampered, COMP)).toBeNull();
  });

  test('rejects a token replayed against a different component (AAD mismatch)', () => {
    installConfig();
    const json = devalueStringify({ islandId: 'mochi-abc-0', name: 'World' });
    const token = encryptProps(json, COMP);
    expect(decryptProps(token, 'OtherIsland')).toBeNull();
  });

  test('rejects garbage input', () => {
    installConfig();
    expect(decryptProps('not-a-valid-token', COMP)).toBeNull();
    expect(decryptProps('', COMP)).toBeNull();
  });
});

describe('encryptProps debug bar recording', () => {
  test('records decoded props in debugBarData when in dev mode', () => {
    installConfig();
    withCtx(
      (ctx) => {
        const props = { islandId: 'mochi-test-0', greeting: 'Hello', count: 42 };
        const json = devalueStringify(props);
        encryptProps(json, COMP);

        const recorded = ctx.debugBarData!.islandProps['mochi-test-0'];
        expect(recorded).toBeDefined();
        const parsed = JSON.parse(recorded!);
        expect(parsed.islandId).toBe('mochi-test-0');
        expect(parsed.greeting).toBe('Hello');
        expect(parsed.count).toBe(42);
        expect(recorded).toContain('\n');
      },
      { dev: true },
    );
  });

  test('does not record when debugBarData is undefined (prod)', () => {
    installConfig();
    withCtx((ctx) => {
      const json = devalueStringify({ islandId: 'mochi-test-0', x: 1 });
      const token = encryptProps(json, COMP);
      expect(ctx.debugBarData).toBeUndefined();
      expect(decryptProps(token, COMP)).toBe(json);
    });
  });

  test('does not record when called outside request context', () => {
    installConfig();
    const json = devalueStringify({ islandId: 'mochi-test-0' });
    let token: string | undefined;
    expect(() => {
      token = encryptProps(json, COMP);
    }).not.toThrow();
    expect(token).toBeDefined();
    expect(decryptProps(token!, COMP)).toBe(json);
  });

  test('encryption still works even if debug recording fails', () => {
    installConfig();
    withCtx(
      (ctx) => {
        // Pass invalid devalue JSON — debug recording should fail silently
        const badJson = '{not valid devalue}';
        const token = encryptProps(badJson, COMP);
        expect(token).toBeDefined();
        expect(Object.keys(ctx.debugBarData!.islandProps)).toHaveLength(0);
      },
      { dev: true },
    );
  });
});
