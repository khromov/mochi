import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

const HeaderWebSocket = WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocket;

function route(origin: Parameters<typeof Mochi.ws>[1] = {}) {
  return Mochi.ws(
    {
      upgrade(req) {
        return {
          origin: req.headers.get('origin'),
          cookie: req.headers.get('cookie'),
        };
      },
      open(ws) {
        ws.send(JSON.stringify(ws.data.user));
      },
      message() {},
    },
    origin,
  );
}

describe('WebSocket Origin policy', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  let wsBase: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-ws-origin-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      proxy: { hostHeader: 'host' },
      routes: {
        '/default': route(),
        '/trusted': route({ trustedOrigins: ['https://trusted.example'] }),
        '/missing': route({ allowMissingOrigin: true }),
        '/disabled': route({ checkOrigin: false }),
      },
    });
    base = `http://localhost:${server.port}`;
    wsBase = `ws://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  const connect = (pathname: string, headers?: Record<string, string>): Promise<{ opened: boolean; message?: { origin: string | null; cookie: string | null } }> =>
    new Promise((resolve) => {
      const ws = headers ? new HeaderWebSocket(`${wsBase}${pathname}`, { headers }) : new WebSocket(`${wsBase}${pathname}`);
      let settled = false;
      const finish = (result: { opened: boolean; message?: { origin: string | null; cookie: string | null } }) => {
        if (settled) {
          return;
        }
        settled = true;
        ws.close();
        resolve(result);
      };
      ws.addEventListener(
        'message',
        (event) => {
          const text = typeof event.data === 'string' ? event.data : '';
          finish({ opened: true, message: JSON.parse(text) as { origin: string | null; cookie: string | null } });
        },
        { once: true },
      );
      ws.addEventListener('error', () => finish({ opened: false }), { once: true });
      setTimeout(() => finish({ opened: ws.readyState === WebSocket.OPEN }), 2_000);
    });

  test('accepts the exact public origin and carries ambient cookies', async () => {
    const result = await connect('/default', { Origin: base, Cookie: 'session=victim-session' });
    expect(result.opened).toBe(true);
    expect(result.message).toEqual({ origin: base, cookie: 'session=victim-session' });
  });

  test('rejects a foreign browser origin', async () => {
    expect(await connect('/default', { Origin: 'https://attacker.example', Cookie: 'session=victim-session' })).toEqual({ opened: false });
  });

  test('rejects a missing or malformed Origin by default', async () => {
    expect(await connect('/default')).toEqual({ opened: false });
    expect(await connect('/default', { Origin: 'https://victim.example@attacker.example' })).toEqual({ opened: false });
  });

  test('allows explicit trusted origins', async () => {
    const result = await connect('/trusted', { Origin: 'https://trusted.example' });
    expect(result.opened).toBe(true);
    expect(result.message?.origin).toBe('https://trusted.example');
  });

  test('supports explicit non-browser and disabled-check policies', async () => {
    expect((await connect('/missing')).opened).toBe(true);
    expect((await connect('/disabled', { Origin: 'https://attacker.example' })).opened).toBe(true);
  });
});
