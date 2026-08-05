// `inlineNestedIslands: false` is the global kill switch: island-endpoint renders never arm inlining, so nested
// defer sites keep the classic per-level fetch placeholders. Separate file because Mochi.serve() is one-per-process.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from '../Mochi';

const FIXTURE_PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'inline-islands', 'Page.svelte');

describe('inlineNestedIslands: false', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-inline-off-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      inlineNestedIslands: false,
      outDir,
      routes: {
        '/': Mochi.page(FIXTURE_PAGE),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('nested defer sites keep their fetch placeholders', async () => {
    const html = await (await fetch(`${base}/`)).text();
    const chain = html.match(/<mochi-server-island\b[^>]*component-name="(Chain_\w+)"[^>]*>/)!;
    const token = chain[0].match(/signed-props="([^"]+)"/)![1]!;

    const res = await fetch(`${base}/_mochi/island/${chain[1]}?props=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    const body = await res.text();

    expect(body).toContain('data-marker="chain"');
    expect(body).toContain('data-marker="child-fallback"');
    expect(body).not.toContain('data-marker="child"');
    expect(body).toMatch(/<mochi-server-island\b[^>]*component-name="Child_\w+"/);
  });
});
