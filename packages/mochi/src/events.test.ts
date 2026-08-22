import { afterEach, describe, expect, test } from 'bun:test';
import type { MochiEmitter, MochiCaptchaVerifyEvent } from './events';
import { hasSubscribers, mochiEvents } from './events';

const globalSlot = () => (globalThis as unknown as Record<string, unknown>).__mochi_events__ as MochiEmitter;

describe('mochiEvents', () => {
  test('is pinned on globalThis under __mochi_events__', () => {
    expect(globalSlot()).toBe(mochiEvents);
  });

  test('re-importing the module returns the same instance', async () => {
    const a = (await import('./events')).mochiEvents;
    expect(a).toBe(mochiEvents);
    expect(a).toBe(globalSlot());
  });

  test('roundtrip emit/subscribe works for captcha:verify', () => {
    let received: MochiCaptchaVerifyEvent | null = null;
    const handler = (e: MochiCaptchaVerifyEvent) => {
      received = e;
    };
    mochiEvents.on('captcha:verify', handler);
    mochiEvents.emit('captcha:verify', { ok: false, reason: 'replay', bits: 16, ageMs: 4200 });
    mochiEvents.off('captcha:verify', handler);
    expect(received as MochiCaptchaVerifyEvent | null).toEqual({ ok: false, reason: 'replay', bits: 16, ageMs: 4200 });
  });

  test('roundtrip emit/subscribe works', () => {
    let received: { path: string; type: string } | null = null;
    const handler = (e: { path: string; type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir' }) => {
      received = { path: e.path, type: e.type };
    };
    mochiEvents.on('file:change', handler);
    mochiEvents.emit('file:change', { path: '/tmp/a.md', type: 'change' });
    mochiEvents.off('file:change', handler);
    expect(received as { path: string; type: string } | null).toEqual({
      path: '/tmp/a.md',
      type: 'change',
    });
  });

  test('recompile:module-churn is part of the event map', () => {
    let received: unknown = null;
    const handler = (e: unknown) => {
      received = e;
    };
    mochiEvents.on('recompile:module-churn', handler);
    mochiEvents.emit('recompile:module-churn', { reloadCount: 10 });
    mochiEvents.off('recompile:module-churn', handler);
    expect(received).toEqual({ reloadCount: 10 });
  });

  test('queue:completed is part of the event map', () => {
    let received: unknown = null;
    const handler = (e: unknown) => {
      received = e;
    };
    mochiEvents.on('queue:completed', handler);
    mochiEvents.emit('queue:completed', { queue: 'emails', jobId: 'j1', attempt: 1, duration: 12 });
    mochiEvents.off('queue:completed', handler);
    expect(received).toEqual({
      queue: 'emails',
      jobId: 'j1',
      attempt: 1,
      duration: 12,
    });
  });
});

describe('mochiEvents.setHandler', () => {
  afterEach(() => {
    mochiEvents.all.clear();
  });

  test('registering twice under the same name replaces the prior handler', () => {
    const calls: string[] = [];
    mochiEvents.setHandler('x', 'file:change', () => {
      calls.push('first');
    });
    mochiEvents.setHandler('x', 'file:change', () => {
      calls.push('second');
    });
    mochiEvents.emit('file:change', { path: '/tmp/a.md', type: 'change' });
    expect(calls).toEqual(['second']);
  });

  test('different names coexist', () => {
    const calls: string[] = [];
    mochiEvents.setHandler('a', 'file:change', () => calls.push('a'));
    mochiEvents.setHandler('b', 'file:change', () => calls.push('b'));
    mochiEvents.emit('file:change', { path: '/tmp/x.md', type: 'change' });
    expect(calls.sort()).toEqual(['a', 'b']);
  });

  test('rebinding a name to a different event unregisters the prior event type', () => {
    const calls: string[] = [];
    mochiEvents.setHandler('x', 'file:change', () => calls.push('file'));
    mochiEvents.setHandler('x', 'request', () => calls.push('req'));
    mochiEvents.emit('file:change', { path: '/tmp/a.md', type: 'change' });
    mochiEvents.emit('request', {
      requestId: 'rid-test',
      kind: 'page',
      method: 'GET',
      path: '/',
      status: 200,
      duration: 1,
    });
    expect(calls).toEqual(['req']);
  });

  test('repeated registrations do not pile up subscribers on mitt', () => {
    const handler = () => {};
    for (let i = 0; i < 50; i++) {
      mochiEvents.setHandler('loop', 'file:change', handler);
    }
    const subscribers = mochiEvents.all.get('file:change') ?? [];
    expect(subscribers.length).toBe(1);
  });

  test('removeHandler unregisters the named handler', () => {
    const calls: string[] = [];
    mochiEvents.setHandler('gone', 'file:change', () => calls.push('gone'));
    mochiEvents.setHandler('kept', 'file:change', () => calls.push('kept'));

    mochiEvents.removeHandler('gone');
    mochiEvents.emit('file:change', { path: '/tmp/a.md', type: 'change' });

    expect(calls).toEqual(['kept']);
    expect(mochiEvents.all.get('file:change')?.length).toBe(1);
  });

  test('removeHandler frees the name for reuse and is a no-op when unknown', () => {
    const calls: string[] = [];
    expect(() => mochiEvents.removeHandler('never-registered')).not.toThrow();

    mochiEvents.setHandler('reused', 'file:change', () => calls.push('first'));
    mochiEvents.removeHandler('reused');
    // The name table entry is gone, so this registers cleanly rather than
    // re-removing a stale handler.
    mochiEvents.setHandler('reused', 'file:change', () => calls.push('second'));
    mochiEvents.emit('file:change', { path: '/tmp/a.md', type: 'change' });

    expect(calls).toEqual(['second']);
  });
});

describe('hasSubscribers', () => {
  afterEach(() => {
    mochiEvents.all.clear();
  });

  test('reports false when nothing is subscribed', () => {
    expect(hasSubscribers('compile:error')).toBe(false);
  });

  test('reports true after a handler is registered', () => {
    mochiEvents.on('compile:error', () => {});
    expect(hasSubscribers('compile:error')).toBe(true);
  });

  test('reports false again after the handler is removed', () => {
    const handler = () => {};
    mochiEvents.on('error', handler);
    expect(hasSubscribers('error')).toBe(true);
    mochiEvents.off('error', handler);
    expect(hasSubscribers('error')).toBe(false);
  });
});

describe('new event payloads round-trip', () => {
  afterEach(() => {
    mochiEvents.all.clear();
  });

  test('server:start', () => {
    let received: unknown;
    mochiEvents.on('server:start', (e) => {
      received = e;
    });
    mochiEvents.emit('server:start', {
      port: 3333,
      hostname: 'localhost',
      development: true,
      routes: { page: 2, api: 1, ws: 0, sse: 0, file: 0 },
    });
    expect(received).toEqual({
      port: 3333,
      hostname: 'localhost',
      development: true,
      routes: { page: 2, api: 1, ws: 0, sse: 0, file: 0 },
    });
  });

  test('server:stop', () => {
    let received: unknown;
    mochiEvents.on('server:stop', (e) => {
      received = e;
    });
    mochiEvents.emit('server:stop', { reason: 'signal', signal: 'SIGTERM' });
    expect(received).toEqual({ reason: 'signal', signal: 'SIGTERM' });
  });

  test('error', () => {
    let received: unknown;
    mochiEvents.on('error', (e) => {
      received = e;
    });
    mochiEvents.emit('error', {
      requestId: 'rid-1',
      kind: 'page',
      path: '/oops',
      method: 'GET',
      status: 500,
      message: 'boom',
    });
    expect(received).toEqual({
      requestId: 'rid-1',
      kind: 'page',
      path: '/oops',
      method: 'GET',
      status: 500,
      message: 'boom',
    });
  });

  test('action:invoke', () => {
    let received: unknown;
    mochiEvents.on('action:invoke', (e) => {
      received = e;
    });
    mochiEvents.emit('action:invoke', {
      requestId: 'rid-2',
      path: '/login',
      actionName: 'submit',
    });
    expect(received).toEqual({
      requestId: 'rid-2',
      path: '/login',
      actionName: 'submit',
    });
  });

  test('action:complete carries matching requestId', () => {
    const seen: Array<{ phase: string; requestId: string }> = [];
    mochiEvents.on('action:invoke', ({ requestId }) => seen.push({ phase: 'invoke', requestId }));
    mochiEvents.on('action:complete', ({ requestId }) => seen.push({ phase: 'complete', requestId }));
    mochiEvents.emit('action:invoke', { requestId: 'r', path: '/x', actionName: 'go' });
    mochiEvents.emit('action:complete', {
      requestId: 'r',
      path: '/x',
      actionName: 'go',
      result: 'success',
    });
    expect(seen).toEqual([
      { phase: 'invoke', requestId: 'r' },
      { phase: 'complete', requestId: 'r' },
    ]);
  });

  test('compile:start and compile:complete', () => {
    const seen: string[] = [];
    mochiEvents.on('compile:start', ({ path }) => seen.push(`start:${path}`));
    mochiEvents.on('compile:complete', ({ path }) => seen.push(`done:${path}`));
    mochiEvents.emit('compile:start', { path: '/p/Foo.svelte' });
    mochiEvents.emit('compile:complete', {
      path: '/p/Foo.svelte',
      ssrSizeBytes: 1234,
      hydratableCount: 0,
      serverIslandCount: 0,
      durationMs: 12,
    });
    expect(seen).toEqual(['start:/p/Foo.svelte', 'done:/p/Foo.svelte']);
  });

  test('image:store', () => {
    let received: unknown;
    mochiEvents.on('image:store', (e) => {
      received = e;
    });
    mochiEvents.emit('image:store', {
      kind: 'variant',
      src: 'https://cdn.example/a.jpg',
      path: '/cache/hash/v1.webp',
      id: 'v1',
      size: 4096,
      contentType: 'image/webp',
      width: 200,
      height: 100,
      format: 'webp',
    });
    expect(received).toEqual({
      kind: 'variant',
      src: 'https://cdn.example/a.jpg',
      path: '/cache/hash/v1.webp',
      id: 'v1',
      size: 4096,
      contentType: 'image/webp',
      width: 200,
      height: 100,
      format: 'webp',
    });
  });

  test('image:delete', () => {
    let received: unknown;
    mochiEvents.on('image:delete', (e) => {
      received = e;
    });
    mochiEvents.emit('image:delete', {
      kind: 'original',
      src: 'https://cdn.example/a.jpg',
      path: '/cache/hash/original.jpg',
      id: 'o1',
      size: 8192,
      reason: 'evicted',
    });
    expect(received).toEqual({
      kind: 'original',
      src: 'https://cdn.example/a.jpg',
      path: '/cache/hash/original.jpg',
      id: 'o1',
      size: 8192,
      reason: 'evicted',
    });
  });

  test('compile:error carries structured logs', () => {
    let received: unknown;
    mochiEvents.on('compile:error', (e) => {
      received = e;
    });
    mochiEvents.emit('compile:error', {
      path: '/p/Bad.svelte',
      message: 'nope',
      logs: [{ file: '/p/Bad.svelte', line: 3, column: 5, message: 'unexpected' }],
    });
    expect(received).toEqual({
      path: '/p/Bad.svelte',
      message: 'nope',
      logs: [{ file: '/p/Bad.svelte', line: 3, column: 5, message: 'unexpected' }],
    });
  });
});
