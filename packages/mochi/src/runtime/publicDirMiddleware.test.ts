import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from '../Mochi';
import type { Handle } from './hooks';

// Pins the contract the middleware and serve-options docs state: publicDir files are native Bun routes that `handle`
// never sees, so middleware can neither gate them nor add headers. If this starts failing, update those docs.
describe('publicDir files bypass handle middleware', () => {
  let server: Server<undefined>;
  let outDir: string;
  let publicDir: string;
  let base: string;
  const seen: string[] = [];

  const denyAll: Handle = async ({ event, resolve }) => {
    seen.push(event.url.pathname);
    if (!event.request.headers.get('Authorization')) {
      return new Response('Unauthorized', { status: 401, headers: { 'X-From-Handle': '1' } });
    }
    return resolve(event);
  };

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-public-mw-out-'));
    publicDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-public-mw-'));
    writeFileSync(path.join(publicDir, 'file.txt'), 'PUBLIC_BYTES');
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      publicDir,
      handle: denyAll,
      routes: { '/api': Mochi.api(async () => Response.json({ ok: true })) },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
    rmSync(publicDir, { recursive: true, force: true });
  });

  test('handle gates an api route', async () => {
    const res = await fetch(`${base}/api`);
    expect(res.status).toBe(401);
    expect(seen).toContain('/api');
  });

  test('handle never runs for a publicDir file', async () => {
    const res = await fetch(`${base}/file.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('PUBLIC_BYTES');
    expect(res.headers.get('X-From-Handle')).toBeNull();
    expect(seen).not.toContain('/file.txt');
  });
});
