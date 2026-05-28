import { afterEach, describe, expect, test } from 'bun:test';
import { stringify as devalueStringify } from 'devalue';
import { signProps, verifyAndDecodeProps } from './serverIslandCrypto';
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

afterEach(() => {
  removeConfig();
});

describe('signProps + verifyAndDecodeProps', () => {
  test('round-trips: verify decodes what sign produces', () => {
    installConfig();
    const json = devalueStringify({ islandId: 'mochi-abc-0', name: 'World' });
    const token = signProps(json);
    const decoded = verifyAndDecodeProps(token);
    expect(decoded).toBe(json);
  });

  test('rejects a tampered token', () => {
    installConfig();
    const json = devalueStringify({ islandId: 'mochi-abc-0' });
    const token = signProps(json);
    const tampered = 'X' + token.slice(1);
    expect(verifyAndDecodeProps(tampered)).toBeNull();
  });

  test('rejects a token with no dot separator', () => {
    expect(verifyAndDecodeProps('nodothere')).toBeNull();
  });
});

describe('signProps debug bar recording', () => {
  test('records decoded props in debugBarData when in dev mode', () => {
    installConfig();
    withCtx(
      (ctx) => {
        const props = { islandId: 'mochi-test-0', greeting: 'Hello', count: 42 };
        const json = devalueStringify(props);
        signProps(json);

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
      const token = signProps(json);
      expect(ctx.debugBarData).toBeUndefined();
      expect(verifyAndDecodeProps(token)).toBe(json);
    });
  });

  test('does not record when called outside request context', () => {
    installConfig();
    const json = devalueStringify({ islandId: 'mochi-test-0' });
    let token: string | undefined;
    expect(() => {
      token = signProps(json);
    }).not.toThrow();
    expect(token).toBeDefined();
    expect(verifyAndDecodeProps(token!)).toBe(json);
  });

  test('signing still works even if debug recording fails', () => {
    installConfig();
    withCtx(
      (ctx) => {
        // Pass invalid devalue JSON — debug recording should fail silently
        const badJson = '{not valid devalue}';
        const token = signProps(badJson);
        expect(token).toBeDefined();
        expect(Object.keys(ctx.debugBarData!.islandProps)).toHaveLength(0);
      },
      { dev: true },
    );
  });
});
