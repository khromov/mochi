import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

describe('SSE protocol hardening', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  let methodHandlerCalls = 0;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-sse-security-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {
        '/data': Mochi.sse((stream) => {
          stream.send('one\rtwo\r\nthree\nfour');
          stream.close();
        }),
        '/bad-event': Mochi.sse((stream) => {
          stream.send('safe', { event: 'notice\rdata: injected' });
          stream.close();
        }),
        '/methods': Mochi.sse((stream) => {
          methodHandlerCalls += 1;
          stream.send('ok');
          stream.close();
        }),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('encodes CR, CRLF, and LF as data lines instead of new fields', async () => {
    const response = await fetch(`${base}/data`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('data: one\ndata: two\ndata: three\ndata: four\n\n');
  });

  test('rejects CR/LF in event metadata', async () => {
    const response = await fetch(`${base}/bad-event`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  test('only GET invokes an SSE handler', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      const response = await fetch(`${base}/methods`, { method });
      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('GET');
    }
    expect(methodHandlerCalls).toBe(0);

    const response = await fetch(`${base}/methods`);
    expect(response.status).toBe(200);
    await response.text();
    expect(methodHandlerCalls).toBe(1);
  });
});
