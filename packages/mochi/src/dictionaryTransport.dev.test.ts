import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

const HOME = path.join(import.meta.dir, '__fixtures__', 'dictionary', 'Home.svelte');

describe('compression dictionary transport is inert in development', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-dict-dev-'));
    server = await Mochi.serve({
      port: 0,
      development: true,
      logger: { enabled: false },
      outDir,
      dictionary: true,
      routes: { '/': Mochi.page(HOME) },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('the dictionary route is not registered', async () => {
    const res = await fetch(`${base}/_mochi/dictionary`);
    expect(res.status).toBe(404);
  });

  test('pages carry no dictionary headers', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('link')).toBeNull();
    expect(res.headers.get('vary')).toBeNull();
  });
});
