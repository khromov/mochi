import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import type { Server } from 'bun';
import { makeRequestContextBuilder, type RequestSetupConfig } from './requestSetup';
import { MochiCookieJar } from './cookies';
import { mochiEvents, type MochiRequestEvent } from '../events';
import { DEFAULT_FORM_CONTENT_TYPES, DEFAULT_PROTECTED_METHODS } from './csrf';
import { initExtensions } from '../extensions';
import type { ProtectionGateInput } from '../protection/gate';

const ORIGIN = 'http://localhost:3333';

function mockServer() {
  const timeout = mock(() => {});
  const server = {
    timeout,
    requestIP: () => null,
  } as unknown as Server<undefined>;
  return { server, timeout };
}

function mockReq(method: string, path: string, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, { method, headers });
}

function makeConfig(overrides: Partial<RequestSetupConfig> = {}): RequestSetupConfig {
  return {
    proxy: { origin: ORIGIN },
    csrf: undefined,
    trailingSlashPolicy: undefined,
    cookieDefaults: {},
    csp: false,
    development: false,
    debugBarEnabled: false,
    formContentTypes: DEFAULT_FORM_CONTENT_TYPES,
    protectedMethods: DEFAULT_PROTECTED_METHODS,
    trustedOrigins: new Set<string>(),
    newRequestId: () => 'test-request-id',
    ...overrides,
  };
}

function captureRequestEvents() {
  const events: MochiRequestEvent[] = [];
  const handler = (e: MochiRequestEvent) => events.push(e);
  mochiEvents.on('request', handler);
  return { events, off: () => mochiEvents.off('request', handler) };
}

describe('makeRequestContextBuilder', () => {
  beforeEach(() => {
    initExtensions({});
  });

  afterEach(() => {
    initExtensions({});
  });

  test('kind: "page" returns a fully populated ctx with debugBarData when enabled', async () => {
    const build = makeRequestContextBuilder(makeConfig({ debugBarEnabled: true }));
    const { server } = mockServer();
    const setup = await build(mockReq('GET', '/foo/'), server, { kind: 'page', pattern: '/foo/' });

    if ('earlyResponse' in setup) {
      throw new Error('expected ok setup');
    }
    expect(setup.requestId).toBe('test-request-id');
    expect(setup.url.pathname).toBe('/foo/');
    expect(setup.ctx.locals).toEqual({});
    expect(setup.ctx.cookies).toBeInstanceOf(MochiCookieJar);
    expect(setup.ctx.islandProps).toBeInstanceOf(Map);
    expect(typeof setup.ctx.getClientAddress).toBe('function');
    expect(setup.ctx.debugBarData).toBeDefined();
    expect(setup.ctx.debugBarData!.route).toBe('/foo/');
  });

  test('kind: "api" produces no debugBarData even when enabled', async () => {
    const build = makeRequestContextBuilder(makeConfig({ debugBarEnabled: true }));
    const { server } = mockServer();
    const setup = await build(mockReq('GET', '/api/x'), server, { kind: 'api', pattern: '/api/x' });

    if ('earlyResponse' in setup) {
      throw new Error('expected ok setup');
    }
    expect(setup.ctx.debugBarData).toBeUndefined();
  });

  test('kind: "page" calls server.timeout(req, 0)', async () => {
    const build = makeRequestContextBuilder(makeConfig());
    const { server, timeout } = mockServer();
    const req = mockReq('GET', '/');
    await build(req, server, { kind: 'page', pattern: '/' });
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(req, 0);
  });

  test('kind: "sse" calls server.timeout(req, 0)', async () => {
    const build = makeRequestContextBuilder(makeConfig());
    const { server, timeout } = mockServer();
    const req = mockReq('GET', '/');
    await build(req, server, { kind: 'sse', pattern: '/' });
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(req, 0);
  });

  test('kind: "ws" does not call server.timeout', async () => {
    const build = makeRequestContextBuilder(makeConfig());
    const { server, timeout } = mockServer();
    await build(mockReq('GET', '/ws'), server, { kind: 'ws', pattern: '/ws' });
    expect(timeout).not.toHaveBeenCalled();
  });

  test('kind: "ws" skips trailing-slash redirects even when the policy would trigger', async () => {
    const build = makeRequestContextBuilder(makeConfig({ trailingSlashPolicy: 'always' }));
    const { server } = mockServer();
    const setup = await build(mockReq('GET', '/ws'), server, { kind: 'ws', pattern: '/ws' });
    expect('earlyResponse' in setup).toBe(false);
  });

  test('kind: "api" skips trailing-slash redirects even when the policy would trigger', async () => {
    const build = makeRequestContextBuilder(makeConfig({ trailingSlashPolicy: 'always' }));
    const { server } = mockServer();
    const setup = await build(mockReq('GET', '/api/ping'), server, { kind: 'api', pattern: '/api/ping' });
    expect('earlyResponse' in setup).toBe(false);
  });

  test('kind: "page" with trailingSlashPolicy: "always" redirects and emits a request event', async () => {
    const build = makeRequestContextBuilder(makeConfig({ trailingSlashPolicy: 'always' }));
    const { server } = mockServer();
    const cap = captureRequestEvents();
    try {
      const setup = await build(mockReq('GET', '/foo'), server, { kind: 'page', pattern: '/foo' });
      if (!('earlyResponse' in setup)) {
        throw new Error('expected early response');
      }
      expect(setup.earlyResponse.status).toBe(301);
      expect(setup.earlyResponse.headers.get('Location')).toBe('/foo/');
      expect(cap.events).toHaveLength(1);
      expect(cap.events[0]).toMatchObject({
        kind: 'page',
        method: 'GET',
        path: '/foo',
        status: 301,
      });
    } finally {
      cap.off();
    }
  });

  test('kind: "sse" skips trailing-slash redirects even when the policy would trigger', async () => {
    const build = makeRequestContextBuilder(makeConfig({ trailingSlashPolicy: 'always' }));
    const { server } = mockServer();
    const cap = captureRequestEvents();
    try {
      const setup = await build(mockReq('GET', '/foo'), server, { kind: 'sse', pattern: '/foo' });
      expect('earlyResponse' in setup).toBe(false);
      expect(cap.events).toHaveLength(0);
    } finally {
      cap.off();
    }
  });

  test('kind: "file" skips trailing-slash redirects even when the policy would trigger', async () => {
    const build = makeRequestContextBuilder(makeConfig({ trailingSlashPolicy: 'always' }));
    const { server } = mockServer();
    const setup = await build(mockReq('GET', '/files/report'), server, { kind: 'file', pattern: '/files/report' });
    expect('earlyResponse' in setup).toBe(false);
  });

  test('kind: "page" rejects cross-origin form POST and emits a request event', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const build = makeRequestContextBuilder(makeConfig());
      const { server } = mockServer();
      const cap = captureRequestEvents();
      try {
        const req = mockReq('POST', '/submit', {
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'http://evil.example',
        });
        const setup = await build(req, server, { kind: 'page', pattern: '/submit' });
        if (!('earlyResponse' in setup)) {
          throw new Error('expected early response');
        }
        expect(setup.earlyResponse.status).toBe(403);
        expect(cap.events).toHaveLength(1);
        expect(cap.events[0]?.status).toBe(403);
      } finally {
        cap.off();
      }
    } finally {
      warn.mockRestore();
    }
  });

  test('csrfErrorTransform replaces the rejection response', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const build = makeRequestContextBuilder(makeConfig());
      const { server } = mockServer();
      const req = mockReq('POST', '/submit', {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'http://evil.example',
      });
      const setup = await build(req, server, {
        kind: 'page',
        pattern: '/submit',
        csrfErrorTransform: (resp) => new Response('json error', { status: resp.status, headers: { 'X-Transformed': '1' } }),
      });
      if (!('earlyResponse' in setup)) {
        throw new Error('expected early response');
      }
      expect(setup.earlyResponse.status).toBe(403);
      expect(setup.earlyResponse.headers.get('X-Transformed')).toBe('1');
    } finally {
      warn.mockRestore();
    }
  });

  test('paramsOverride wins over extracted params on ctx, but setup.params keeps the extracted values', async () => {
    const build = makeRequestContextBuilder(makeConfig());
    const { server } = mockServer();
    // Bun stores route params on req.params; we simulate that by attaching them.
    const req = mockReq('GET', '/_mochi/island/MyComp');
    (req as unknown as { params: Record<string, string> }).params = { componentName: 'MyComp' };

    const setup = await build(req, server, {
      kind: 'island',
      pattern: '/_mochi/island/:componentName',
      paramsOverride: {},
    });
    if ('earlyResponse' in setup) {
      throw new Error('expected ok setup');
    }
    expect(setup.ctx.params).toEqual({});
    expect(setup.params).toEqual({ componentName: 'MyComp' });
  });

  test('debugBarData seeds pageCacheEnabled=true and empty varyOnCookies while pageCache is being rebuilt', async () => {
    const build = makeRequestContextBuilder(makeConfig({ debugBarEnabled: true }));
    const { server } = mockServer();
    const req = mockReq('GET', '/foo/', { cookie: 'session=abc; theme=dark' });
    const setup = await build(req, server, { kind: 'page', pattern: '/foo/' });
    if ('earlyResponse' in setup) {
      throw new Error('expected ok setup');
    }
    expect(setup.ctx.debugBarData?.pageCacheEnabled).toBe(true);
    expect(setup.ctx.debugBarData?.varyOnCookies).toEqual([]);
    expect(setup.ctx.cookies.wasAccessed()).toBe(false);
  });

  test('ctx.cookies parses an incoming Cookie header', async () => {
    const build = makeRequestContextBuilder(makeConfig());
    const { server } = mockServer();
    const req = mockReq('GET', '/', { cookie: 'session=abc; theme=dark' });
    const setup = await build(req, server, { kind: 'page', pattern: '/' });
    if ('earlyResponse' in setup) {
      throw new Error('expected ok setup');
    }
    expect(setup.ctx.cookies.get('session')).toBe('abc');
    expect(setup.ctx.cookies.get('theme')).toBe('dark');
  });

  describe('protection gate', () => {
    test('a blocking gate short-circuits with its response and emits a request event', async () => {
      const seen: ProtectionGateInput[] = [];
      const build = makeRequestContextBuilder(
        makeConfig({
          protection: async (input) => {
            seen.push(input);
            return new Response('blocked', { status: 403 });
          },
        }),
      );
      const { server } = mockServer();
      const cap = captureRequestEvents();
      try {
        const setup = await build(mockReq('GET', '/members/', { cookie: 'a=b' }), server, { kind: 'page', pattern: '/members/' });
        if (!('earlyResponse' in setup)) {
          throw new Error('expected early response');
        }
        expect(setup.earlyResponse.status).toBe(403);
        expect(cap.events).toHaveLength(1);
        expect(cap.events[0]).toMatchObject({ kind: 'page', status: 403 });
        expect(seen).toHaveLength(1);
        expect(seen[0]?.kind).toBe('page');
        expect(seen[0]?.url.pathname).toBe('/members/');
        expect(seen[0]?.cookies.get('a')).toBe('b');
      } finally {
        cap.off();
      }
    });

    test('a passing gate lets the request through with a normal ctx', async () => {
      const build = makeRequestContextBuilder(makeConfig({ protection: async () => undefined }));
      const { server } = mockServer();
      const setup = await build(mockReq('GET', '/'), server, { kind: 'page', pattern: '/' });
      expect('earlyResponse' in setup).toBe(false);
    });

    test('the gate runs for every route kind', async () => {
      const kinds: string[] = [];
      const build = makeRequestContextBuilder(
        makeConfig({
          protection: async (input) => {
            kinds.push(input.kind);
            return undefined;
          },
        }),
      );
      const { server } = mockServer();
      for (const kind of ['page', 'api', 'ws', 'sse', 'island', 'file'] as const) {
        await build(mockReq('GET', '/x'), server, { kind, pattern: '/x' });
      }
      expect(kinds).toEqual(['page', 'api', 'ws', 'sse', 'island', 'file']);
    });

    test('skipProtection bypasses the gate', async () => {
      const gate = mock(async () => new Response('blocked', { status: 403 }));
      const build = makeRequestContextBuilder(makeConfig({ protection: gate }));
      const { server } = mockServer();
      const setup = await build(mockReq('POST', '/_mochi/protection/verify', { origin: ORIGIN }), server, {
        kind: 'api',
        pattern: '/_mochi/protection/verify',
        skipProtection: true,
      });
      expect('earlyResponse' in setup).toBe(false);
      expect(gate).not.toHaveBeenCalled();
    });

    test('the trailing-slash redirect wins over the gate', async () => {
      const gate = mock(async () => new Response('blocked', { status: 403 }));
      const build = makeRequestContextBuilder(makeConfig({ trailingSlashPolicy: 'always', protection: gate }));
      const { server } = mockServer();
      const cap = captureRequestEvents();
      try {
        const setup = await build(mockReq('GET', '/foo'), server, { kind: 'page', pattern: '/foo' });
        if (!('earlyResponse' in setup)) {
          throw new Error('expected early response');
        }
        expect(setup.earlyResponse.status).toBe(301);
        expect(gate).not.toHaveBeenCalled();
      } finally {
        cap.off();
      }
    });
  });
});
