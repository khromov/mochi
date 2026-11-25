// Production mode with a configured public origin: the setup a deployed app uses, where a cross-site socket would ride the visitor's cookies.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { getRequestContext } from './runtime/requestContext';
import { mochiEvents, type MochiRequestEvent } from './events';

describe('Mochi.ws() upgrade origin check', () => {
  let server: Server<undefined>;
  let outDir: string;
  let port: number;
  const statuses: number[] = [];
  const onRequest = (event: MochiRequestEvent) => {
    if (event.path.startsWith('/ws/')) {
      statuses.push(event.status);
    }
  };

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-ws-origin-'));
    mochiEvents.on('request', onRequest);
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      proxy: { origin: 'https://app.example' },
      csrf: { trustedOrigins: ['https://partner.example'] },
      routes: {
        '/ws/account': Mochi.ws({
          upgrade() {
            return getRequestContext().cookies.get('session') === 'victim' ? 'account-secret' : false;
          },
          open(ws) {
            ws.send(String(ws.data.user));
          },
          message() {},
        }),
      },
    });
    if (server.port == null) {
      throw new Error('server.port not set');
    }
    port = server.port;
  });

  afterAll(async () => {
    mochiEvents.off('request', onRequest);
    await server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  function connect(origin?: string): Promise<string> {
    const headers: Record<string, string> = { cookie: 'session=victim' };
    if (origin) {
      headers.origin = origin;
    }
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws/account`, { headers } as unknown as string[]);
      ws.onmessage = (event) => {
        ws.close();
        resolve(String(event.data));
      };
      ws.onerror = () => resolve('rejected');
      setTimeout(() => resolve('timeout'), 5000);
    });
  }

  test('rejects a cookie-authenticated upgrade from a foreign origin with 403', async () => {
    statuses.length = 0;
    expect(await connect('https://evil.example')).toBe('rejected');
    expect(statuses).toEqual([403]);
  });

  test('accepts the configured public origin', async () => {
    expect(await connect('https://app.example')).toBe('account-secret');
  });

  test('accepts the configured origin with an explicit default port', async () => {
    expect(await connect('https://app.example:443')).toBe('account-secret');
  });

  test('accepts an origin listed in csrf.trustedOrigins', async () => {
    expect(await connect('https://partner.example')).toBe('account-secret');
  });

  test('accepts a page served from the host the socket connects to', async () => {
    expect(await connect(`http://localhost:${port}`)).toBe('account-secret');
  });

  test('accepts a non-browser client that sends no Origin', async () => {
    expect(await connect()).toBe('account-secret');
  });

  test('rejects a sibling port on the same host, which is same-site but cross-origin', async () => {
    expect(await connect(`http://localhost:${port + 1}`)).toBe('rejected');
  });
});
