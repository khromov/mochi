import { afterAll, beforeAll, describe, expect, spyOn, test, type Mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { redirect } from './runtime/forms';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'css-imports', 'Page.svelte');

let server: Server<undefined>;
let outDir: string;
let base: string;
let warn: Mock<typeof console.warn>;

beforeAll(async () => {
  outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-redirect-dev-'));
  server = await Mochi.serve({
    port: 0,
    development: true,
    logger: { enabled: false },
    outDir,
    routes: {
      '/go': Mochi.page(FIXTURE_PAGE, {
        serverProps: (req) => redirect(303, new URL(req.url).searchParams.get('next') ?? '/'),
      }),
    },
  });
  base = `http://localhost:${server.port}`;
  warn = spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  warn.mockRestore();
  server.stop(true);
  rmSync(outDir, { recursive: true, force: true });
});

const go = (next: string): Promise<Response> => fetch(`${base}/go?next=${encodeURIComponent(next)}`, { redirect: 'manual' });

describe('redirect guard (development)', () => {
  test('warns about an off-origin redirect but lets it through', async () => {
    warn.mockClear();
    const res = await go('https://evil.example/x');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://evil.example/x');
    expect(warn.mock.calls.some((args) => args.join(' ').includes('would be blocked in production'))).toBe(true);
  });

  test('still blocks a script-capable scheme', async () => {
    const res = await go('javascript:alert(1)');
    expect(res.status).toBe(500);
    expect(res.headers.get('location')).toBeNull();
  });
});
