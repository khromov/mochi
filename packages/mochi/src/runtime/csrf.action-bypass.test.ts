// Previously .isolated.test.ts — all tests now run in isolated processes.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from '../Mochi';
import { success } from './forms';

// Probe: when a cross-origin POST sneaks past the CSRF gate by sending a
// non-form Content-Type (or none at all), does the action HANDLER actually
// run? If req.formData() throws first, we get a 400 and the side effect
// never fires — which is the property we want to confirm.

const FIXTURE_PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'css-imports', 'Page.svelte');

describe('action handlers cannot be invoked with non-form Content-Type', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  let invocations: string[] = [];

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-csrf-bypass-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      proxy: { hostHeader: 'host' },
      logger: { enabled: false },
      outDir,
      routes: {
        '/page': Mochi.page(FIXTURE_PAGE, {
          actions: {
            default: async ({ formData }) => {
              invocations.push(`default:${formData.get('a') ?? ''}`);
              return success();
            },
          },
        }),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('cross-origin POST with no Content-Type: blocked by CSRF (treated as simple request)', async () => {
    invocations = [];
    const res = await fetch(`${base}/page`, {
      method: 'POST',
      headers: { origin: 'http://evil.example' },
      body: new Blob(['a=1'], { type: '' }),
    });
    expect(res.status).toBe(403);
    expect(invocations).toEqual([]);
  });

  test('cross-origin POST with application/json: CSRF skipped, but action does not run', async () => {
    invocations = [];
    const res = await fetch(`${base}/page`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://evil.example',
      },
      body: JSON.stringify({ a: 1 }),
    });
    expect(res.status).toBe(400);
    expect(invocations).toEqual([]);
  });

  test('cross-origin POST with application/octet-stream: CSRF skipped, but action does not run', async () => {
    invocations = [];
    const res = await fetch(`${base}/page`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        origin: 'http://evil.example',
      },
      body: 'a=1',
    });
    expect(res.status).toBe(400);
    expect(invocations).toEqual([]);
  });

  test('control: same-origin form POST DOES invoke the action', async () => {
    invocations = [];
    const res = await fetch(`${base}/page`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: base,
      },
      body: 'a=1',
    });
    expect(res.status).toBe(200);
    expect(invocations).toEqual(['default:1']);
  });
});
