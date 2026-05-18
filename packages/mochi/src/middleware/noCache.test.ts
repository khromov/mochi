import { describe, expect, test } from 'bun:test';
import type { Server } from 'bun';
import type { MochiEvent, MochiEventKind } from '../hooks';
import { noCache } from './noCache';

function makeEvent(req: Request, kind: MochiEventKind): MochiEvent {
  return {
    request: req,
    url: new URL(req.url),
    server: {} as Server<undefined>,
    locals: {},
    kind,
  };
}

describe('noCache()', () => {
  test('sets Cache-Control: no-cache on page responses without one', async () => {
    const req = new Request('http://localhost/');
    const response = await noCache({
      event: makeEvent(req, 'page'),
      resolve: async () => new Response('<p>hi</p>', { headers: { 'Content-Type': 'text/html' } }),
    });

    expect(response.headers.get('Cache-Control')).toBe('no-cache');
  });

  test('sets Cache-Control: no-cache on api responses without one', async () => {
    const req = new Request('http://localhost/api/foo');
    const response = await noCache({
      event: makeEvent(req, 'api'),
      resolve: async () => new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }),
    });

    expect(response.headers.get('Cache-Control')).toBe('no-cache');
  });

  test('preserves an existing Cache-Control on page responses', async () => {
    const req = new Request('http://localhost/');
    const response = await noCache({
      event: makeEvent(req, 'page'),
      resolve: async () =>
        new Response('<p>hi</p>', {
          headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=60' },
        }),
    });

    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
  });

  test('preserves an existing Cache-Control on api responses', async () => {
    const req = new Request('http://localhost/api/foo');
    const response = await noCache({
      event: makeEvent(req, 'api'),
      resolve: async () =>
        new Response('{"ok":true}', {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
        }),
    });

    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  test('detects existing Cache-Control case-insensitively', async () => {
    const req = new Request('http://localhost/');
    const upstream = new Response('<p>hi</p>', { headers: { 'Content-Type': 'text/html' } });
    upstream.headers.set('cache-control', 'public, max-age=120');

    const response = await noCache({
      event: makeEvent(req, 'page'),
      resolve: async () => upstream,
    });

    expect(response.headers.get('Cache-Control')).toBe('public, max-age=120');
  });

  test('passes through asset responses without setting Cache-Control', async () => {
    const req = new Request('http://localhost/_mochi/client/foo.js');
    const response = await noCache({
      event: makeEvent(req, 'asset'),
      resolve: async () => new Response('console.log(1)', { headers: { 'Content-Type': 'application/javascript' } }),
    });

    expect(response.headers.get('Cache-Control')).toBeNull();
  });

  test('passes through fallback responses without setting Cache-Control', async () => {
    const req = new Request('http://localhost/whatever');
    const response = await noCache({
      event: makeEvent(req, 'fallback'),
      resolve: async () => new Response('ok'),
    });

    expect(response.headers.get('Cache-Control')).toBeNull();
  });

  test('passes through error responses without setting Cache-Control', async () => {
    const req = new Request('http://localhost/missing');
    const response = await noCache({
      event: makeEvent(req, 'error'),
      resolve: async () => new Response('not found', { status: 404 }),
    });

    expect(response.headers.get('Cache-Control')).toBeNull();
  });
});
