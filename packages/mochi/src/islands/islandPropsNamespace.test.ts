// A server island renders in its own request, so without a per-render namespace its props blocks restart at
// `mochi-props-0` and, once spliced into the page, a page island resolving its ref in tree order reads the fragment's
// payload instead of its own. Separate file because Mochi.serve() is one-per-process.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from '../Mochi';

const FIXTURE_PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'island-props-collision', 'Page.svelte');

const blockIds = (html: string) => [...html.matchAll(/<script type="application\/json" id="([^"]+)"/g)].map((m) => m[1]!);
const propsRefs = (html: string) => [...html.matchAll(/props-ref="([^"]+)"/g)].map((m) => m[1]!);

describe('island props ids across a page and its server island fragment', () => {
  let server: Server<undefined>;
  let outDir: string;
  let page: string;
  let fragment: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-props-namespace-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: { '/': Mochi.page(FIXTURE_PAGE) },
    });
    const base = `http://localhost:${server.port}`;
    page = await (await fetch(`${base}/`)).text();
    const wrapper = page.match(/<mochi-server-island\b[^>]*>/)![0];
    const name = wrapper.match(/component-name="([^"]+)"/)![1]!;
    const token = wrapper.match(/signed-props="([^"]+)"/)![1]!;
    const res = await fetch(`${base}/_mochi/island/${name}?props=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    fragment = await res.text();
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('the fragment emits props ids the page does not', () => {
    const pageIds = blockIds(page);
    const fragmentIds = blockIds(fragment);
    expect(pageIds).toEqual(['mochi-props-0']);
    expect(fragmentIds).toHaveLength(1);
    expect(fragmentIds.filter((id) => pageIds.includes(id))).toEqual([]);
  });

  test("each island's props-ref names a block from its own render", () => {
    expect(propsRefs(page)).toEqual(blockIds(page));
    expect(propsRefs(fragment)).toEqual(blockIds(fragment));
  });
});
