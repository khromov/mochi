import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

// Proves the two claims in `160-serve-options.md`: `bun: { idleTimeout }` reaches Bun.serve(), and a handler can
// override it per-request with `server.timeout(request, seconds)`. A quiet stream is the only way to observe the idle
// timer, and it must be driven over a raw socket — in-process `fetch()` against the loopback silently keeps the socket
// active, so it never trips the timeout. `api` is the kind under test because it does not auto-disable the timer the way
// `page`/`sse` do (see KIND_POLICY in runtime/requestSetup.ts).

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function quietStream(): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(controller) {
        controller.enqueue(enc.encode('hi '));
        await sleep(6000); // silent for longer than idleTimeout, so an un-extended request is cut mid-stream
        controller.enqueue(enc.encode('bye'));
        controller.close();
      },
    }),
  );
}

function rawGet(port: number, pathname: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`GET ${pathname} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    });
    let buf = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => (buf += chunk));
    socket.on('close', () => resolve(buf));
    socket.on('error', reject);
  });
}

describe('bun.idleTimeout passthrough + server.timeout()', () => {
  let server: Server<undefined>;
  let outDir: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-bun-timeout-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      bun: { idleTimeout: 2 },
      routes: {
        '/quiet': Mochi.api(() => quietStream()),
        '/quiet-extended': Mochi.api(({ server, request }) => {
          server.timeout(request, 0);
          return quietStream();
        }),
      },
    });
  }, 20000);

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('bun.idleTimeout is applied — a quiet stream is cut mid-response', async () => {
    const body = await rawGet(server.port!, '/quiet');
    expect(body).toContain('hi '); // first chunk flushed before the gap
    expect(body).not.toContain('bye'); // connection closed during the 6s silence
  }, 20000);

  test('server.timeout(request, 0) overrides it — the stream runs to completion', async () => {
    const body = await rawGet(server.port!, '/quiet-extended');
    expect(body).toContain('hi ');
    expect(body).toContain('bye');
  }, 20000);
});
