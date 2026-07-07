import { beforeEach, describe, expect, test } from 'bun:test';
import type { MochiServeOptions } from './types';
import { applyFilter, initExtensions, runHook, type MochiFilterContext } from './extensions';
import type { IslandPropsEntry } from './islandPropsRegistry';
import type { ResolvedEmailMessage } from './email/types';

const fakeOptions = {} as MochiServeOptions;

// Registry is process-global, so wipe it before every test to prevent a test
// that forgets `initExtensions` from inheriting fixtures from the previous one.
beforeEach(() => initExtensions({}));

describe('runHook', () => {
  test('no-op when no hook registered', async () => {
    initExtensions({});
    await expect(runHook('mochi:init', { options: fakeOptions })).resolves.toBeUndefined();
  });

  test('awaits an async user hook', async () => {
    let resolved = false;
    initExtensions({
      eventHooks: {
        'mochi:init': async () => {
          await Bun.sleep(5);
          resolved = true;
        },
      },
    });
    await runHook('mochi:init', { options: fakeOptions });
    expect(resolved).toBe(true);
  });

  test('passes the context object through to the user hook', async () => {
    let received: { options: MochiServeOptions } | null = null;
    initExtensions({
      eventHooks: {
        'mochi:init': (ctx) => {
          received = ctx;
        },
      },
    });
    await runHook('mochi:init', { options: fakeOptions });
    expect(received).not.toBeNull();
    expect(received!.options).toBe(fakeOptions);
  });

  // Sync throws bubble out of runHook synchronously; async rejections come back
  // as a rejected promise. Both paths abort `serve()` because the call site
  // `await`s — but pin the current shape so any regression is intentional.
  test('synchronous throw from a user hook propagates to the caller', () => {
    initExtensions({
      eventHooks: {
        'mochi:init': () => {
          throw new Error('boom');
        },
      },
    });
    expect(() => runHook('mochi:init', { options: fakeOptions })).toThrow('boom');
  });

  test('rejection from an async user hook propagates to the caller', async () => {
    initExtensions({
      eventHooks: {
        'mochi:init': async () => {
          throw new Error('boom-async');
        },
      },
    });
    await expect(runHook('mochi:init', { options: fakeOptions })).rejects.toThrow('boom-async');
  });
});

describe('applyFilter', () => {
  test('returns the input unchanged when no filter registered', () => {
    initExtensions({});
    const input = new Set(['a', 'b']);
    const result = applyFilter('csrf:formContentTypes', input, { options: fakeOptions });
    expect(result).toBe(input);
  });

  test('returns the user-supplied replacement value', () => {
    initExtensions({
      filters: {
        'csrf:formContentTypes': () => new Set(['application/csp-report']),
      },
    });
    const result = applyFilter('csrf:formContentTypes', new Set(['a']), { options: fakeOptions });
    expect([...result]).toEqual(['application/csp-report']);
  });

  test('user may mutate the input Set in place and return it', () => {
    initExtensions({
      filters: {
        'csrf:protectedMethods': (methods) => {
          methods.delete('DELETE');
          return methods;
        },
      },
    });
    const result = applyFilter('csrf:protectedMethods', new Set(['POST', 'DELETE']), {
      options: fakeOptions,
    });
    expect(result.has('DELETE')).toBe(false);
    expect(result.has('POST')).toBe(true);
  });

  test('passes the existing value as the first argument', () => {
    const received: { value: Set<string> | null } = { value: null };
    initExtensions({
      filters: {
        'csrf:formContentTypes': (value) => {
          received.value = value;
          return value;
        },
      },
    });
    const input = new Set(['a/b']);
    applyFilter('csrf:formContentTypes', input, { options: fakeOptions });
    expect(received.value).toBe(input);
  });
});

// New extension points added in this PR. Each is exercised at the
// applyFilter / runHook level to lock the registry wiring; per-feature
// behavioural tests (cookie defaults applied, csrf trusted-origin honoured,
// shutdown signal received) live in the consumer modules' own test files.
describe('new extension points', () => {
  test('csrf:trustedOrigins replaces the trusted-origin set', () => {
    initExtensions({
      filters: {
        'csrf:trustedOrigins': (origins) => {
          origins.add('https://embed.example');
          return origins;
        },
      },
    });
    const result = applyFilter('csrf:trustedOrigins', new Set<string>(), { options: fakeOptions });
    expect(result.has('https://embed.example')).toBe(true);
  });

  test('cookie:defaults returns merged options', () => {
    initExtensions({
      filters: {
        'cookie:defaults': (defaults) => ({ ...defaults, secure: true, sameSite: 'Lax' }),
      },
    });
    const result = applyFilter('cookie:defaults', {}, { options: fakeOptions });
    expect(result.secure).toBe(true);
    expect(result.sameSite).toBe('Lax');
  });

  test('html:shell rewrites the template string', () => {
    initExtensions({
      filters: {
        'html:shell': (tpl) => tpl.replace('{{mochi.head}}', '<meta name="x">{{mochi.head}}'),
      },
    });
    const result = applyFilter('html:shell', '<head>{{mochi.head}}</head>', {
      options: fakeOptions,
      development: false,
    });
    expect(result).toContain('<meta name="x">');
  });

  test('serverIsland:secretKey awaits an async user filter', async () => {
    initExtensions({
      filters: {
        'serverIsland:secretKey': async () => {
          await Bun.sleep(5);
          return Buffer.from('user-supplied-key-bytes-padding-32', 'utf-8');
        },
      },
    });
    const result = await applyFilter('serverIsland:secretKey', Buffer.alloc(32), {
      options: fakeOptions,
      envKeyPresent: false,
    });
    expect(result.toString('utf-8')).toBe('user-supplied-key-bytes-padding-32');
  });

  test('serverIsland:secretKey resolves to the input when no filter registered', async () => {
    const input = Buffer.from('default-key', 'utf-8');
    const result = await applyFilter('serverIsland:secretKey', input, {
      options: fakeOptions,
      envKeyPresent: true,
    });
    expect(result).toBe(input);
  });

  test('payload:compressMinBytes returns the default unchanged when no filter registered', () => {
    const result = applyFilter('payload:compressMinBytes', 80, { options: fakeOptions, payload: new Uint8Array(120) });
    expect(result).toBe(80);
  });

  test('payload:compressMinBytes can decide per-payload from the bytes in context', () => {
    initExtensions({
      filters: {
        // Never compress payloads whose first byte is 0xff, otherwise use the default.
        'payload:compressMinBytes': (def, { payload }) => (payload[0] === 0xff ? Infinity : def),
      },
    });
    expect(applyFilter('payload:compressMinBytes', 80, { options: fakeOptions, payload: Uint8Array.of(0xff, 1, 2) })).toBe(Infinity);
    expect(applyFilter('payload:compressMinBytes', 80, { options: fakeOptions, payload: Uint8Array.of(0x01, 1, 2) })).toBe(80);
  });

  test('compile:preprocessors returns the user-supplied list', () => {
    const fakePreprocessor = { name: 'fake', markup: () => ({ code: '' }) };
    initExtensions({
      filters: {
        'compile:preprocessors': () => [fakePreprocessor],
      },
    });
    const result = applyFilter('compile:preprocessors', [], {
      filename: 'src/Page.svelte',
      target: 'server',
      development: true,
    });
    expect(result).toEqual([fakePreprocessor]);
  });

  const fakeLineCtx = (overrides: Partial<MochiFilterContext['consoleLogger:line']> = {}) =>
    ({
      level: 'info',
      label: 'GET ',
      path: '/foo',
      status: 200,
      kind: 'page',
      source: {
        name: 'request',
        payload: { requestId: 'rid', kind: 'page', method: 'GET', path: '/foo', status: 200, duration: 5 },
      },
      ...overrides,
    }) satisfies MochiFilterContext['consoleLogger:line'];

  test('consoleLogger:line returns the input unchanged when no filter registered', () => {
    const result = applyFilter('consoleLogger:line', 'GET /foo 200 5ms', fakeLineCtx());
    expect(result).toBe('GET /foo 200 5ms');
  });

  test('consoleLogger:line lets the user rewrite the line', () => {
    initExtensions({
      filters: {
        'consoleLogger:line': (line) => line.replace('foo', 'bar'),
      },
    });
    const result = applyFilter('consoleLogger:line', 'GET /foo 200 5ms', fakeLineCtx());
    expect(result).toBe('GET /bar 200 5ms');
  });

  test('consoleLogger:line returning null short-circuits the log', () => {
    initExtensions({
      filters: {
        'consoleLogger:line': (line, { path }) => (path.startsWith('/.well-known/') ? null : line),
      },
    });
    const dropped = applyFilter('consoleLogger:line', 'GET /.well-known/foo 404 5ms', fakeLineCtx({ path: '/.well-known/foo', status: 404, level: 'log' }));
    expect(dropped).toBeNull();
    const kept = applyFilter('consoleLogger:line', 'GET /foo 200 5ms', fakeLineCtx());
    expect(kept).toBe('GET /foo 200 5ms');
  });

  test('consoleLogger:line receives the resolved level in context', () => {
    const seen: { level?: string } = {};
    initExtensions({
      filters: {
        'consoleLogger:line': (line, ctx) => {
          seen.level = ctx.level;
          return line;
        },
      },
    });
    applyFilter('consoleLogger:line', 'a', fakeLineCtx({ level: 'warn' }));
    expect(seen.level).toBe('warn');
  });

  test('consoleLogger:line can narrow on source.name to access typed per-event fields', () => {
    const captured: { requestId?: string; size?: number } = {};
    initExtensions({
      filters: {
        'consoleLogger:line': (line, { source }) => {
          if (source.name === 'request') {
            captured.requestId = source.payload.requestId;
          }
          if (source.name === 'ws:message') {
            captured.size = source.payload.size;
          }
          return line;
        },
      },
    });
    applyFilter('consoleLogger:line', 'a', fakeLineCtx());
    expect(captured.requestId).toBe('rid');
    applyFilter(
      'consoleLogger:line',
      'b',
      fakeLineCtx({
        label: 'WS  ',
        kind: undefined,
        status: undefined,
        source: { name: 'ws:message', payload: { path: '/ws', size: 42, type: 'text' } },
      }),
    );
    expect(captured.size).toBe(42);
  });

  test('mochi:ready awaits an async user hook', async () => {
    let saw: { server: unknown; options: unknown } | null = null;
    initExtensions({
      eventHooks: {
        'mochi:ready': async (ctx) => {
          await Bun.sleep(1);
          saw = ctx;
        },
      },
    });
    const fakeServer = { stop: () => {} } as never;
    await runHook('mochi:ready', { options: fakeOptions, server: fakeServer });
    expect(saw).not.toBeNull();
    expect(saw!.server).toBe(fakeServer);
  });

  test('mochi:shutdown awaits an async user hook and receives the signal', async () => {
    const captured: { signal?: NodeJS.Signals } = {};
    initExtensions({
      eventHooks: {
        'mochi:shutdown': async (ctx) => {
          captured.signal = ctx.signal;
        },
      },
    });
    const fakeServer = { stop: () => {} } as never;
    await runHook('mochi:shutdown', {
      options: fakeOptions,
      server: fakeServer,
      signal: 'SIGTERM',
    });
    expect(captured.signal).toBe('SIGTERM');
  });

  test('route:matched fires synchronously with pattern + kind + params', () => {
    const seen: { pattern?: string; kind?: string; method?: string } = {};
    initExtensions({
      eventHooks: {
        'route:matched': (ctx) => {
          seen.pattern = ctx.pattern;
          seen.kind = ctx.kind;
          seen.method = ctx.request.method;
        },
      },
    });
    runHook('route:matched', {
      pattern: '/users/:id',
      request: new Request('http://localhost/users/42'),
      url: new URL('http://localhost/users/42'),
      params: { id: '42' },
      kind: 'page',
    });
    expect(seen.pattern).toBe('/users/:id');
    expect(seen.kind).toBe('page');
    expect(seen.method).toBe('GET');
  });

  test('publicDir:scan can add a virtual entry to the served map', async () => {
    initExtensions({
      filters: {
        'publicDir:scan': async (files) => {
          files.set('/virtual.txt', '/dev/null');
          return files;
        },
      },
    });
    const result = await applyFilter('publicDir:scan', new Map<string, string>(), {
      publicDir: './public',
      development: true,
    });
    expect(result.get('/virtual.txt')).toBe('/dev/null');
  });

  test('publicDir:scan resolves to the input map when no filter registered', async () => {
    const input = new Map([['/foo.png', '/abs/foo.png']]);
    const result = await applyFilter('publicDir:scan', input, {
      publicDir: './public',
      development: false,
    });
    expect(result).toBe(input);
  });

  test('csrf:check can bypass the framework default by returning null', () => {
    const blocking = new Response('blocked', { status: 403 });
    initExtensions({
      filters: {
        'csrf:check': () => null,
      },
    });
    const result = applyFilter('csrf:check', blocking, {
      request: new Request('http://localhost/submit', { method: 'POST' }),
      url: new URL('http://localhost/submit'),
    });
    expect(result).toBeNull();
  });

  test('csrf:check can substitute a custom Response', () => {
    initExtensions({
      filters: {
        'csrf:check': () => new Response('go away', { status: 418 }),
      },
    });
    const result = applyFilter('csrf:check', null, {
      request: new Request('http://localhost/submit', { method: 'POST' }),
      url: new URL('http://localhost/submit'),
    });
    expect(result?.status).toBe(418);
  });

  test('csrf:check delegates to framework default when filter returns input unchanged', () => {
    const blocking = new Response('blocked', { status: 403 });
    initExtensions({
      filters: {
        'csrf:check': (decision) => decision,
      },
    });
    const result = applyFilter('csrf:check', blocking, {
      request: new Request('http://localhost/submit', { method: 'POST' }),
      url: new URL('http://localhost/submit'),
    });
    expect(result).toBe(blocking);
  });

  test('image:url returns the input URL unchanged when no filter registered', () => {
    const input = '/_mochi/image/photo-500x500.webp?p=tok';
    const result = applyFilter('image:url', input, {
      src: 'https://example.com/photo.jpg',
      filename: 'photo-500x500.webp',
      original: false,
    });
    expect(result).toBe(input);
  });

  test('image:url rewrites the returned URL (e.g. prepend a CDN origin)', () => {
    initExtensions({
      filters: {
        'image:url': (url) => `https://cdn.example.com${url}`,
      },
    });
    const result = applyFilter('image:url', '/_mochi/image/photo-500x500.webp?p=tok', {
      src: 'https://example.com/photo.jpg',
      filename: 'photo-500x500.webp',
      original: false,
    });
    expect(result).toBe('https://cdn.example.com/_mochi/image/photo-500x500.webp?p=tok');
  });

  test('image:url can branch on the original flag and src in context', () => {
    initExtensions({
      filters: {
        'image:url': (url, { original, src }) => (original && src.endsWith('.jpg') ? `https://originals.example.com${url}` : url),
      },
    });
    const ctx = { src: 'https://example.com/photo.jpg', filename: 'photo-original.jpg' };
    expect(applyFilter('image:url', '/a?p=t', { ...ctx, original: true })).toBe('https://originals.example.com/a?p=t');
    expect(applyFilter('image:url', '/a?p=t', { ...ctx, original: false })).toBe('/a?p=t');
  });

  const fakeResolved = (overrides: Partial<ResolvedEmailMessage> = {}): ResolvedEmailMessage => ({
    from: 'noreply@test.dev',
    to: ['user@example.com'],
    subject: 'Hi',
    html: '<p>Hello</p>',
    text: 'Hello',
    ...overrides,
  });

  test('email:message resolves to the input message unchanged when no filter registered', async () => {
    const input = fakeResolved();
    const result = await applyFilter('email:message', input, { transport: 'dev' });
    expect(result).toBe(input);
  });

  test('email:message can rewrite the outgoing message (inject a header)', async () => {
    initExtensions({
      filters: {
        'email:message': (msg) => ({ ...msg, headers: { ...msg.headers, 'List-Unsubscribe': '<mailto:x@y.dev>' } }),
      },
    });
    const result = await applyFilter('email:message', fakeResolved(), { transport: 'smtp' });
    expect(result?.headers?.['List-Unsubscribe']).toBe('<mailto:x@y.dev>');
  });

  test('email:message returning null vetoes the send', async () => {
    initExtensions({
      filters: {
        'email:message': () => null,
      },
    });
    const result = await applyFilter('email:message', fakeResolved(), { transport: 'dev' });
    expect(result).toBeNull();
  });

  test('email:message can branch on the configured transport in context', async () => {
    initExtensions({
      filters: {
        'email:message': (msg, { transport }) => (transport === 'smtp' ? { ...msg, to: ['catchall@test.dev'] } : msg),
      },
    });
    const rerouted = await applyFilter('email:message', fakeResolved(), { transport: 'smtp' });
    expect(rerouted?.to).toEqual(['catchall@test.dev']);
    const untouched = await applyFilter('email:message', fakeResolved(), { transport: 'dev' });
    expect(untouched?.to).toEqual(['user@example.com']);
  });

  test('trailingSlash:redirect can suppress the redirect for a specific path', () => {
    const redirect = new Response(null, { status: 308, headers: { Location: '/mcp/' } });
    initExtensions({
      filters: {
        'trailingSlash:redirect': (computed, { url }) => (url.pathname === '/mcp' ? null : computed),
      },
    });
    const exempt = applyFilter('trailingSlash:redirect', redirect, {
      request: new Request('http://localhost/mcp'),
      url: new URL('http://localhost/mcp'),
      policy: 'always',
    });
    expect(exempt).toBeNull();
    const other = applyFilter('trailingSlash:redirect', redirect, {
      request: new Request('http://localhost/docs'),
      url: new URL('http://localhost/docs'),
      policy: 'always',
    });
    expect(other).toBe(redirect);
  });

  test('trailingSlash:redirect leaves the computed redirect untouched with no filter', () => {
    const redirect = new Response(null, { status: 308, headers: { Location: '/foo/' } });
    initExtensions({ filters: {} });
    const result = applyFilter('trailingSlash:redirect', redirect, {
      request: new Request('http://localhost/foo'),
      url: new URL('http://localhost/foo'),
      policy: 'always',
    });
    expect(result).toBe(redirect);
  });

  // The runtime fires `route:matched` from inside `requestContext.run(...)`
  // for all four kinds (page, api, ws, sse). Drive the same shape here to lock
  // the contract that `getRequestContext()` works inside the hook regardless
  // of route type.
  test.each(['ws', 'sse'] as const)('route:matched exposes requestContext for kind %s', async (kind) => {
    const { requestContext, getRequestContext } = await import('./requestContext');
    const { MochiCookieJar } = await import('./cookies');
    let seen: { requestId: string; kind: string; pathname: string; param: string } | null = null;
    initExtensions({
      eventHooks: {
        'route:matched': (ctx) => {
          const rc = getRequestContext();
          seen = {
            requestId: rc.requestId,
            kind: ctx.kind,
            pathname: rc.url.pathname,
            param: rc.params.id ?? '',
          };
        },
      },
    });
    const url = new URL('http://localhost/users/42');
    const ctx = {
      requestId: 'rid-route-matched',
      request: new Request(url),
      url,
      params: { id: '42' },
      locals: {},
      isWarmup: false,
      cookies: new MochiCookieJar(null),
      islandProps: new Map<string, IslandPropsEntry>(),
      getClientAddress: () => null,
    };
    requestContext.run(ctx, () => {
      runHook('route:matched', {
        pattern: '/users/:id',
        request: ctx.request,
        url,
        params: ctx.params,
        kind,
      });
    });
    expect(seen).not.toBeNull();
    expect(seen!.kind).toBe(kind);
    expect(seen!.requestId).toBe('rid-route-matched');
    expect(seen!.pathname).toBe('/users/42');
    expect(seen!.param).toBe('42');
  });
});
