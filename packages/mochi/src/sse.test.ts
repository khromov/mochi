import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

describe('Mochi.sse framing', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  const sendErrors: string[] = [];

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-sse-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {
        '/data': Mochi.sse((stream) => {
          stream.send('hello\r\revent: logout\rdata: forged');
          stream.send('a\r\nb\nc');
          stream.close();
        }),
        '/fields': Mochi.sse((stream) => {
          for (const opts of [{ id: '1\ndata: forged' }, { id: '1\rdata: forged' }, { event: 'chat\ndata: forged' }, { event: 'chat\r\ndata: forged' }]) {
            try {
              stream.send('x', opts);
            } catch (err) {
              sendErrors.push((err as Error).message);
            }
          }
          stream.send('ok', { id: '7', event: 'tick' });
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

  test('CR and CRLF in data stay inside one event as separate data lines', async () => {
    const raw = await (await fetch(`${base}/data`)).text();
    expect(raw).not.toContain('\r');
    expect(raw).toBe('data: hello\ndata: \ndata: event: logout\ndata: data: forged\n\n' + 'data: a\ndata: b\ndata: c\n\n');
  });

  test('a line break in id or event throws instead of writing a forged frame', async () => {
    const raw = await (await fetch(`${base}/fields`)).text();
    expect(raw).toBe('id: 7\nevent: tick\ndata: ok\n\n');
    expect(sendErrors).toHaveLength(4);
    for (const message of sendErrors) {
      expect(message).toContain('must not contain CR or LF');
    }
  });
});
