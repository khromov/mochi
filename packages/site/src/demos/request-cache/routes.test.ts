import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from 'mochi-framework';
import { routes } from './routes';

let server: Server<undefined> | undefined;
let outDir: string;

beforeAll(async () => {
  outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '..', '.mochi-request-cache-'));
  server = await Mochi.serve({ port: 0, development: false, logger: { enabled: false }, outDir, routes });
}, 120_000);

afterAll(() => {
  server?.stop(true);
  rmSync(outDir, { recursive: true, force: true });
});

test('one client cannot re-run the whole-book analysis without bound', async () => {
  const url = `http://localhost:${server!.port}/demos/request-cache`;
  const statuses: number[] = [];
  for (let i = 0; i < 61; i++) {
    const res = await fetch(url);
    await res.arrayBuffer();
    statuses.push(res.status);
  }
  expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
  expect(statuses[60]).toBe(429);
}, 60_000);
