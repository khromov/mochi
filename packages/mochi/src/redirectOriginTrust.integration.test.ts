import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { redirect } from './runtime/forms';

// Separate process (one Mochi.serve() per process): production with *no* `proxy` configured. The expected origin then
// comes from the client's own Host header, which is exactly why the CSRF check refuses to trust it — the redirect
// guard has to apply the same rule, or a spoofed Host makes any absolute location "same-origin".

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'css-imports', 'Page.svelte');

let server: Server<undefined>;
let outDir: string;
let port: number;

/** Raw HTTP/1.1 GET — `fetch` will not let a caller forge the `Host` header, which is the whole point here. */
function rawGet(port: number, target: string, host: string): Promise<{ status: number; location: string | null }> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const finish = (): void => {
      const lines = buf.split('\r\n');
      const status = Number(lines[0]?.split(' ')[1] ?? 0);
      const location = lines.slice(1).find((l) => l.toLowerCase().startsWith('location:')) ?? null;
      resolve({ status, location: location ? location.slice(location.indexOf(':') + 1).trim() : null });
    };
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
          if (buf) {
            finish();
          }
        },
      },
    }).catch(reject);
  });
}

beforeAll(async () => {
  outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-redirect-trust-'));
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

describe('redirect guard with no proxy configured', () => {
  test('blocks an absolute redirect that only matches a spoofed Host', async () => {
    const res = await rawGet(port, '/go?next=http://attacker.example/x', 'attacker.example');
    expect(res.location).toBeNull();
    expect(res.status).toBe(500);
  });

  test('still allows a relative redirect', async () => {
    const res = await rawGet(port, '/go?next=/ok', 'attacker.example');
    expect(res.status).toBe(303);
    expect(res.location).toBe('/ok');
  });
});
