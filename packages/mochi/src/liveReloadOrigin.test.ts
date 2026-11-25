// The live-reload socket exists only in development, where the server usually runs on the developer's own machine.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

describe('live-reload socket origin check', () => {
  let server: Server<undefined>;
  let outDir: string;
  let port: number;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-livereload-origin-'));
    server = await Mochi.serve({
      port: 0,
      development: true,
      logger: { enabled: false },
      outDir,
      routes: {},
    });
    if (server.port == null) {
      throw new Error('server.port not set');
    }
    port = server.port;
  });

  afterAll(async () => {
    await server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  function connect(origin?: string): Promise<string> {
    const headers: Record<string, string> = origin ? { origin } : {};
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}/__mochi_live_reload?entry=%2Fhome%2Fdev%2Fapp%2FPage.svelte`, { headers } as unknown as string[]);
      ws.onmessage = (event) => {
        ws.close();
        resolve(String(event.data));
      };
      ws.onerror = () => resolve('rejected');
      setTimeout(() => resolve('timeout'), 5000);
    });
  }

  test('refuses a page on another site', async () => {
    expect(await connect('https://evil.example')).toBe('rejected');
  });

  test('greets the page the dev server itself served', async () => {
    expect(await connect(`http://localhost:${port}`)).toStartWith('boot:');
  });

  test('greets a client that sends no Origin', async () => {
    expect(await connect()).toStartWith('boot:');
  });
});
