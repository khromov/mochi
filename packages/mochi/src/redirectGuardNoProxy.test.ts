import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { redirect } from './runtime/forms';

// Production with no `proxy` configured: the guard falls back to the request's own Host, so same-origin absolute
// redirects keep working without configuration.

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'css-imports', 'Page.svelte');

let server: Server<undefined>;
let outDir: string;
let port: number;

/** Raw HTTP/1.1 GET, because `fetch` will not let a caller set the `Host` header. */
function rawGet(target: string, host: string): Promise<{ status: number; location: string | null }> {
  return new Promise((resolve, reject) => {
    let buf = '';
    Bun.connect({
      hostname: '127.0.0.1',
      port,
      socket: {
        open(socket) {
          socket.write(`GET ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
        },
        data(_socket, chunk) {
          buf += chunk.toString();
        },
        error(_socket, err) {
          reject(err);
        },
        close() {
          const lines = buf.split('\r\n');
          const location = lines.slice(1).find((l) => l.toLowerCase().startsWith('location:'));
          resolve({ status: Number(lines[0]?.split(' ')[1] ?? 0), location: location ? location.slice(location.indexOf(':') + 1).trim() : null });
        },
      },
    }).catch(reject);
  });
}

beforeAll(async () => {
  outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-redirect-noproxy-'));
  server = await Mochi.serve({
    port: 0,
    development: false,
    logger: { enabled: false },
    outDir,
    routes: {
      '/go': Mochi.page(FIXTURE_PAGE, {
        serverProps: (req) => redirect(303, new URL(req.url).searchParams.get('next') ?? '/'),
      }),
    },
  });
  port = server.port!;
});

afterAll(() => {
  server.stop(true);
  rmSync(outDir, { recursive: true, force: true });
});

const go = (next: string, host = 'app.example'): Promise<{ status: number; location: string | null }> => rawGet(`/go?next=${encodeURIComponent(next)}`, host);

describe('redirect guard with no proxy configured', () => {
  test('allows an absolute redirect to the request Host', async () => {
    expect(await go('http://app.example/ok')).toEqual({ status: 303, location: 'http://app.example/ok' });
  });

  test('ignores the scheme, so a TLS-terminating proxy that keeps Host needs no config', async () => {
    expect(await go('https://app.example/ok')).toEqual({ status: 303, location: 'https://app.example/ok' });
  });

  test('compares the port as part of the host', async () => {
    expect(await go('http://app.example:8443/ok', 'app.example:8443')).toEqual({ status: 303, location: 'http://app.example:8443/ok' });
    expect((await go('http://app.example:9999/ok', 'app.example:8443')).status).toBe(500);
  });

  test('blocks an absolute redirect to another host', async () => {
    expect(await go('https://evil.example/x')).toEqual({ status: 500, location: null });
    expect(await go('https://app.example.evil.example/x')).toEqual({ status: 500, location: null });
    expect(await go('//evil.example/x')).toEqual({ status: 500, location: null });
  });

  test('still allows a relative redirect', async () => {
    expect(await go('/ok')).toEqual({ status: 303, location: '/ok' });
  });
});
