import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import type { Handle, MochiEventKind } from './hooks';

// Previously .isolated.test.ts — all tests now run in isolated processes.
// Sister file `middleware.kind.test.ts` covers page/api/asset/fallback;
// this one covers `'error'` (the no-userFetch branch).

describe("event.kind for unmatched URL without userFetch → 'error'", () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  const seen: Array<{ pathname: string; kind: MochiEventKind }> = [];

  const recorder: Handle = async ({ event, resolve }) => {
    seen.push({ pathname: event.url.pathname, kind: event.kind });
    return resolve(event);
  };

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-middleware-kind-error-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      handle: recorder,
      routes: {},
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('unmatched URL is tagged kind: error', async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
    const last = seen.find((entry) => entry.pathname === '/nope');
    expect(last?.kind).toBe('error');
  });
});
