import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

// A plain Bun upstream the proxy forwards to: echoes the path/query for HTTP,
// reflects request headers on /echo-headers, and runs a WS echo.
function startUpstream(): Server<undefined> {
  return Bun.serve({
    port: 0,
    routes: {
      '/echo-headers': (req: Request) =>
        Response.json({
          host: req.headers.get('host'),
          acceptEncoding: req.headers.get('accept-encoding'),
          xCustom: req.headers.get('x-custom'),
        }),
    },
    fetch(req, server) {
      if (req.headers.get('upgrade') === 'websocket') {
        return server.upgrade(req) ? (undefined as unknown as Response) : new Response('no', { status: 400 });
      }
      const url = new URL(req.url);
      return new Response(`upstream:${url.pathname}${url.search}`, { headers: { 'x-upstream': '1' } });
    },
    websocket: {
      open(ws) {
        ws.send('welcome');
      },
      message(ws, msg) {
        ws.send(`echo:${msg}`);
      },
    },
  });
}

describe('Mochi.proxy', () => {
  let upstream: Server<undefined>;
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  let upstreamOrigin: string;

  beforeAll(async () => {
    upstream = startUpstream();
    upstreamOrigin = `http://127.0.0.1:${upstream.port}`;
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-proxy-route-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      // A handle middleware tags every request; it must wrap proxied routes too.
      handle: async ({ event, resolve }) => {
        const res = await resolve(event);
        res.headers.set('x-mw', event.kind);
        return res;
      },
      routes: {
        '/p/:id/*': Mochi.proxy({
          target: ({ params }) => (params.id === 'down' ? null : params.id === 'custom' ? new Response('custom', { status: 418 }) : upstreamOrigin),
          trailingSlashRedirect: true,
          headers: (headers) => {
            headers.set('x-custom', 'added');
          },
          onResponse: (res) => {
            res.headers.set('x-on-response', 'seen');
          },
        }),
        '/noproxy/:id/*': Mochi.proxy({
          target: () => upstreamOrigin,
          ws: false,
        }),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    upstream.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('forwards HTTP with the mount prefix stripped and query preserved', async () => {
    const res = await fetch(`${base}/p/abc/foo/bar?x=1`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('upstream:/foo/bar?x=1');
    expect(res.headers.get('x-upstream')).toBe('1');
  });

  test('runs the global handle middleware (kind = proxy)', async () => {
    const res = await fetch(`${base}/p/abc/foo`);
    expect(res.headers.get('x-mw')).toBe('proxy');
  });

  test('onResponse can mutate the response', async () => {
    const res = await fetch(`${base}/p/abc/foo`);
    expect(res.headers.get('x-on-response')).toBe('seen');
  });

  test('header hygiene: Host set to upstream, custom header added by headers()', async () => {
    const res = await fetch(`${base}/p/abc/echo-headers`);
    const body = (await res.json()) as { host: string; xCustom: string | null };
    expect(body.host).toBe(`127.0.0.1:${upstream.port}`);
    expect(body.xCustom).toBe('added');
  });

  test('target → null responds 502', async () => {
    const res = await fetch(`${base}/p/down/foo`);
    expect(res.status).toBe(502);
  });

  test('target → Response short-circuits', async () => {
    const res = await fetch(`${base}/p/custom/foo`);
    expect(res.status).toBe(418);
    expect(await res.text()).toBe('custom');
  });

  test('trailingSlashRedirect: bare mount 308s to the slash form', async () => {
    const res = await fetch(`${base}/p/abc`, { redirect: 'manual' });
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/p/abc/');
  });

  test('proxies WebSocket frames bidirectionally', async () => {
    const frames = await new Promise<string[]>((resolve) => {
      const msgs: string[] = [];
      const sock = new WebSocket(`ws://localhost:${server.port}/p/abc/socket`);
      sock.onmessage = (e) => {
        msgs.push(String(e.data));
        if (msgs.length === 1) {
          sock.send('ping');
        }
        if (msgs.length === 2) {
          sock.close();
          resolve(msgs);
        }
      };
      sock.onerror = () => resolve(['<error>']);
      setTimeout(() => resolve(msgs.length ? msgs : ['<timeout>']), 3000);
    });
    expect(frames).toEqual(['welcome', 'echo:ping']);
  });

  test('ws: false rejects WebSocket upgrades on that mount', async () => {
    const result = await new Promise<string>((resolve) => {
      const sock = new WebSocket(`ws://localhost:${server.port}/noproxy/abc/socket`);
      sock.onopen = () => {
        sock.close();
        resolve('opened');
      };
      sock.onerror = () => resolve('error');
      setTimeout(() => resolve('timeout'), 2000);
    });
    expect(result).not.toBe('opened');
  });
});
