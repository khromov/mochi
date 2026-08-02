import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { MochiServeOptions } from './types';
import { CLIENT_BUILD_DEFINE } from './compiler/serverOnlyModuleGuard';
import { toPosixPath } from './utils/index';
import { applyFilter, initExtensions, runHook, type MochiFilterContext } from './extensions';
import { reachedStartupMilestones, resetStartupMilestones } from './lifecycle';
import type { IslandPropsEntry } from './islands/islandPropsRegistry';
import type { ResolvedEmailMessage } from './email/types';
import { DEFAULT_CAPTCHA_BITS } from './captcha/config';

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

  test('captcha:bits returns the default unchanged when no filter registered', () => {
    expect(applyFilter('captcha:bits', DEFAULT_CAPTCHA_BITS, { options: {}, configured: false })).toBe(DEFAULT_CAPTCHA_BITS);
  });

  test('captcha:bits can raise the difficulty only where the app did not choose one', () => {
    initExtensions({
      filters: {
        'captcha:bits': (def, { configured }) => (configured ? def : 22),
      },
    });
    expect(applyFilter('captcha:bits', DEFAULT_CAPTCHA_BITS, { options: {}, configured: false })).toBe(22);
    expect(applyFilter('captcha:bits', 12, { options: { bits: 12 }, configured: true })).toBe(12);
  });

  test('captcha:minAgeMs returns the default unchanged when no filter registered', () => {
    expect(applyFilter('captcha:minAgeMs', 2000, { bits: 16, ageMs: 5000, limitMs: 930_000 })).toBe(2000);
  });

  test('captcha:minAgeMs can decide per-token from the context', () => {
    initExtensions({
      filters: {
        // Drop the floor for tokens minted at a difficulty the slow forms use.
        'captcha:minAgeMs': (def, { bits }) => (bits >= 20 ? 0 : def),
      },
    });
    expect(applyFilter('captcha:minAgeMs', 2000, { bits: 20, ageMs: 100, limitMs: 930_000 })).toBe(0);
    expect(applyFilter('captcha:minAgeMs', 2000, { bits: 16, ageMs: 100, limitMs: 930_000 })).toBe(2000);
  });

  test('captcha:driftAllowanceMs returns the default unchanged when no filter registered', () => {
    expect(applyFilter('captcha:driftAllowanceMs', 30_000, { options: {}, maxAgeMs: 900_000 })).toBe(30_000);
  });

  test('captcha:driftAllowanceMs can scale off the resolved maxAgeMs', () => {
    initExtensions({
      filters: {
        'captcha:driftAllowanceMs': (_def, { maxAgeMs }) => maxAgeMs * 0.05,
      },
    });
    expect(applyFilter('captcha:driftAllowanceMs', 30_000, { options: {}, maxAgeMs: 900_000 })).toBe(45_000);
  });

  test('captcha:solveBudgetMs returns the default unchanged when no filter registered', () => {
    expect(applyFilter('captcha:solveBudgetMs', 60_000, { options: {}, bits: 19 })).toBe(60_000);
  });

  test('captcha:solveBudgetMs can scale off the resolved difficulty', () => {
    initExtensions({
      filters: {
        'captcha:solveBudgetMs': (def, { bits }) => (bits > 20 ? def * 2 : def),
      },
    });
    expect(applyFilter('captcha:solveBudgetMs', 60_000, { options: {}, bits: 24 })).toBe(120_000);
    expect(applyFilter('captcha:solveBudgetMs', 60_000, { options: {}, bits: 19 })).toBe(60_000);
  });

  test('jobs:leaseMs returns the default unchanged when no filter registered', () => {
    expect(applyFilter('jobs:leaseMs', 60_000, { explicit: false })).toBe(60_000);
  });

  test('jobs:leaseMs can move the lease while leaving an explicit app choice alone', () => {
    initExtensions({
      filters: {
        'jobs:leaseMs': (value, { explicit }) => (explicit ? value : 120_000),
      },
    });
    expect(applyFilter('jobs:leaseMs', 5_000, { explicit: true })).toBe(5_000);
    expect(applyFilter('jobs:leaseMs', 60_000, { explicit: false })).toBe(120_000);
  });

  test('jobs:pollIntervalMs can slow the poll cadence for a deployment', () => {
    initExtensions({ filters: { 'jobs:pollIntervalMs': () => 10_000 } });
    expect(applyFilter('jobs:pollIntervalMs', 2_000, { explicit: false })).toBe(10_000);
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

  const fakeLevelCtx = (overrides: Partial<MochiFilterContext['consoleLogger:level']> = {}) => {
    const { level: _level, ...rest } = fakeLineCtx();
    return { ...rest, ...overrides } satisfies MochiFilterContext['consoleLogger:level'];
  };

  test('consoleLogger:level returns the input unchanged when no filter registered', () => {
    expect(applyFilter('consoleLogger:level', 'info', fakeLevelCtx())).toBe('info');
  });

  test('consoleLogger:level lets the user remap a line to another severity', () => {
    initExtensions({
      filters: {
        'consoleLogger:level': (level, { path }) => (path.startsWith('/health') ? 'debug' : level),
      },
    });
    expect(applyFilter('consoleLogger:level', 'info', fakeLevelCtx({ path: '/health' }))).toBe('debug');
    expect(applyFilter('consoleLogger:level', 'info', fakeLevelCtx())).toBe('info');
  });

  test('consoleLogger:level can narrow on source.name to remap a specific event', () => {
    initExtensions({
      filters: {
        'consoleLogger:level': (level, { source }) => (source.name === 'queue:added' ? 'debug' : level),
      },
    });
    const remapped = applyFilter(
      'consoleLogger:level',
      'info',
      fakeLevelCtx({
        label: 'QUEUE',
        kind: undefined,
        status: undefined,
        source: { name: 'queue:added', payload: { queue: 'emails', jobId: 'j1', jobName: 'send' } },
      }),
    );
    expect(remapped).toBe('debug');
    expect(applyFilter('consoleLogger:level', 'info', fakeLevelCtx())).toBe('info');
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

  test('mochi:listening receives the bound server', async () => {
    let saw: { server: unknown } | null = null;
    initExtensions({
      eventHooks: {
        'mochi:listening': async (ctx) => {
          await Bun.sleep(1);
          saw = ctx;
        },
      },
    });
    const fakeServer = { stop: () => {} } as never;
    await runHook('mochi:listening', { options: fakeOptions, server: fakeServer });
    expect(saw).not.toBeNull();
    expect(saw!.server).toBe(fakeServer);
  });

  test('mochi:jobsMounted names the mounted job types', async () => {
    const captured: { jobTypes?: string[] } = {};
    initExtensions({
      eventHooks: {
        'mochi:jobsMounted': async (ctx) => {
          await Bun.sleep(1);
          captured.jobTypes = ctx.jobTypes;
        },
      },
    });
    const fakeServer = { stop: () => {} } as never;
    await runHook('mochi:jobsMounted', { options: fakeOptions, server: fakeServer, jobTypes: ['send-email', 'sync-crm'] });
    expect(captured.jobTypes).toEqual(['send-email', 'sync-crm']);
  });

  test('the startup hooks resolve with no user hook registered', async () => {
    initExtensions({});
    const fakeServer = { stop: () => {} } as never;
    await runHook('mochi:listening', { options: fakeOptions, server: fakeServer });
    await runHook('mochi:jobsMounted', { options: fakeOptions, server: fakeServer, jobTypes: [] });
    // Recorded as milestones even when nobody is listening — that record is
    // what the jobs handle reads to tell "too early" from "wrong name".
    expect(reachedStartupMilestones()).toContain('mochi:listening');
    expect(reachedStartupMilestones()).toContain('mochi:jobsMounted');
  });

  test('per-request hooks are not recorded as startup milestones', () => {
    resetStartupMilestones();
    initExtensions({});
    runHook('route:matched', { pattern: '/', request: new Request('http://localhost/'), url: new URL('http://localhost/'), params: {}, kind: 'page' });
    expect(reachedStartupMilestones()).toEqual([]);
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

  test('image:fileFilter returns the default regex unchanged when no filter registered', () => {
    const input = /\.(png|jpe?g)$/i;
    expect(applyFilter('image:fileFilter', input, { target: 'server' })).toBe(input);
  });

  test('image:fileFilter can extend the import regex and branch on target', () => {
    initExtensions({
      filters: {
        'image:fileFilter': (re, { target }) => (target === 'server' ? new RegExp(re.source + '|\\.bmp$', 'i') : re),
      },
    });
    const base = /\.(png)$/i;
    const server = applyFilter('image:fileFilter', base, { target: 'server' });
    expect(server.test('a.bmp')).toBe(true);
    expect(server.test('a.png')).toBe(true);
    expect(applyFilter('image:fileFilter', base, { target: 'client' })).toBe(base);
  });

  test('image:localAssetFilename returns the input unchanged when no filter registered', () => {
    const ctx = { sourcePath: '/src/hero.png', hash: 'abc', ext: 'png', format: 'png' as const, width: 40, height: 30 };
    expect(applyFilter('image:localAssetFilename', 'hero-abc.png', ctx)).toBe('hero-abc.png');
  });

  test('image:localAssetFilename rewrites the emitted filename', () => {
    initExtensions({
      filters: {
        'image:localAssetFilename': (name, { hash }) => `img.${hash}.${name.split('.').pop()}`,
      },
    });
    const ctx = { sourcePath: '/src/hero.png', hash: 'abc', ext: 'png', format: 'png' as const, width: 40, height: 30 };
    expect(applyFilter('image:localAssetFilename', 'hero-abc.png', ctx)).toBe('img.abc.png');
  });

  test('image:localAssetUrl returns the input unchanged when no filter registered', () => {
    const ctx = { sourcePath: '/src/hero.png', filename: 'hero-abc.png', assetPrefix: '/_mochi', format: 'png' as const };
    expect(applyFilter('image:localAssetUrl', '/_mochi/asset/hero-abc.png', ctx)).toBe('/_mochi/asset/hero-abc.png');
  });

  test('image:localAssetUrl can point imports at a CDN', () => {
    initExtensions({
      filters: {
        'image:localAssetUrl': (_url, { filename }) => `https://cdn.example.com/${filename}`,
      },
    });
    const ctx = { sourcePath: '/src/hero.png', filename: 'hero-abc.png', assetPrefix: '/_mochi', format: 'png' as const };
    expect(applyFilter('image:localAssetUrl', '/_mochi/asset/hero-abc.png', ctx)).toBe('https://cdn.example.com/hero-abc.png');
  });

  test('image:localAssetEmitted resolves cleanly when no hook registered', async () => {
    await expect(
      runHook('image:localAssetEmitted', {
        sourcePath: '/src/hero.png',
        diskPath: '/out/assets/hero-abc.png',
        url: '/_mochi/asset/hero-abc.png',
        width: 40,
        height: 30,
        format: 'png',
        contentType: 'image/png',
      }),
    ).resolves.toBeUndefined();
  });

  test('image:localAssetEmitted awaits an async user hook with the asset context', async () => {
    const seen: string[] = [];
    initExtensions({
      eventHooks: {
        'image:localAssetEmitted': async ({ url }) => {
          await Bun.sleep(5);
          seen.push(url);
        },
      },
    });
    await runHook('image:localAssetEmitted', {
      sourcePath: '/src/hero.png',
      diskPath: '/out/assets/hero-abc.png',
      url: '/_mochi/asset/hero-abc.png',
      width: 40,
      height: 30,
      format: 'png',
      contentType: 'image/png',
    });
    expect(seen).toEqual(['/_mochi/asset/hero-abc.png']);
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
    const { requestContext, getRequestContext } = await import('./runtime/requestContext');
    const { MochiCookieJar } = await import('./runtime/cookies');
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

describe('client bundles', () => {
  // The guard is a build-time `define` substitution, so the only honest test is
  // to actually bundle for the browser the way `ComponentRegistry` does and run
  // the result. `outDir` sits under the package so the emitted module resolves
  // its deps through the project's own node_modules chain.
  const tmpDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-extensions-client-'));
  afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

  let bundled: typeof import('./extensions');

  beforeAll(async () => {
    // Source and output must not share a directory: Bun resolves `./entry.js`
    // back to a sibling `entry.ts` when one exists, so importing the bundle
    // would silently hand back the unbundled source and the test would pass
    // against the server build.
    const srcDir = path.join(tmpDir, 'src');
    const outDir = path.join(tmpDir, 'dist');
    mkdirSync(srcDir);
    const entry = path.join(srcDir, 'entry.ts');
    writeFileSync(entry, `export { applyFilter, initExtensions, runHook } from '${toPosixPath(path.join(import.meta.dir, 'extensions'))}';\n`);
    const result = await Bun.build({
      entrypoints: [entry],
      target: 'browser',
      define: { ...CLIENT_BUILD_DEFINE },
      outdir: outDir,
      throw: false,
    });
    if (!result.success) {
      throw new Error(result.logs.map((l) => String(l.message ?? l)).join('\n'));
    }
    bundled = (await import(result.outputs[0]!.path)) as typeof import('./extensions');
  });

  test('applyFilter throws instead of silently returning the default', () => {
    expect(() => bundled.applyFilter('captcha:bits', DEFAULT_CAPTCHA_BITS, { options: {}, configured: false })).toThrow(/applyFilter\('captcha:bits'\) was called in the browser/);
  });

  test('runHook throws', () => {
    expect(() => bundled.runHook('mochi:init', { options: fakeOptions })).toThrow(/runHook\('mochi:init'\) was called in the browser/);
  });

  test('initExtensions throws', () => {
    expect(() => bundled.initExtensions({})).toThrow(/initExtensions\(\) was called in the browser/);
  });
});
