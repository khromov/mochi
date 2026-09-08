// Boots a real Mochi.serve() and opens a real socket, because the request context only exists once a request is
// actually in flight and no exported helper can establish one from a unit test.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { getRequestContext } from './runtime/requestContext';

interface ProbeData {
  clientAddress: string | null;
  params: string;
  error?: string;
}

describe('Mochi.ws() upgrade request context', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-ws-ctx-'));
    server = await Mochi.serve({
      port: 0,
      outDir,
      proxy: { addressHeader: 'x-forwarded-for', xffDepth: 1 },
      routes: {
        '/ws/probe/:room': Mochi.ws<ProbeData>({
          upgrade(_req, params) {
            try {
              return { clientAddress: getRequestContext().getClientAddress(), params: params.room ?? '' };
            } catch (error) {
              return { clientAddress: null, params: '', error: (error as Error).message };
            }
          },
          open(ws) {
            ws.send(JSON.stringify(ws.data.user));
          },
          message() {},
        }),
      },
    });
    base = `ws://localhost:${server.port}`;
  });

  afterAll(async () => {
    await server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  function probe(headers?: Record<string, string>): Promise<ProbeData> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${base}/ws/probe/lobby`, { headers } as unknown as string[]);
      ws.onmessage = (event) => {
        ws.close();
        resolve(JSON.parse(String(event.data)) as ProbeData);
      };
      ws.onerror = () => reject(new Error('socket failed'));
      setTimeout(() => reject(new Error('timed out waiting for the upgrade payload')), 5000);
    });
  }

  test('exposes the request context to the upgrade handler', async () => {
    const data = await probe();
    expect(data.error).toBeUndefined();
    expect(data.params).toBe('lobby');
  });

  test('resolves the forwarded client address through the configured proxy options', async () => {
    const data = await probe({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2' });
    expect(data.error).toBeUndefined();
    expect(data.clientAddress).toBe('10.0.0.2');
  });
});
