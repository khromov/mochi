// Two different components imported under the SAME local name (`Widget`) on two
// different pages must NOT collide at the server-island endpoint. Islands are
// keyed by `<localName>_<hash of resolved path>` (see `islandIdentity`), not the
// bare import name — so each page's `<Widget mochi:defer>` gets its own registry
// entry, its own `component-name`, and its own props-AAD. Without that, the
// registry (a last-write-wins `Map`) would keep only one `Widget` and both
// pages' islands would render whichever component won, decrypting each other's
// props cleanly because the AAD would match too.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { runIsolatedBuild } from '../utils/runIsolatedBuild';
import { Mochi } from '../Mochi';
import type { MochiManifest } from '../types';

const FIXTURES = path.join(import.meta.dir, '..', '__fixtures__', 'name-collision');
const PAGE_A = path.join(FIXTURES, 'PageA.svelte');
const PAGE_B = path.join(FIXTURES, 'PageB.svelte');

describe('server-island name collision', () => {
  let outDir: string;
  let manifest: MochiManifest;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-name-collision-'));
    // PageA mounts at `/`, PageB at `/p1`. Both `import Widget from` a *different*
    // file, so `comp.name` is `Widget` on both.
    await runIsolatedBuild([PAGE_A, PAGE_B], outDir);
    manifest = JSON.parse(await Bun.file(path.join(outDir, 'manifest.json')).text());
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('both same-named islands get distinct registry keys pointing at their own files', () => {
    const entries = Object.entries(manifest.serverIslandPaths ?? {});
    // Two keys, not one — the collision would have left a single `Widget` entry.
    expect(entries).toHaveLength(2);
    for (const [key] of entries) {
      expect(key).toMatch(/^Widget_\w+$/);
    }
    const byFile = (suffix: string) => entries.find(([, p]) => p.endsWith(suffix));
    const a = byFile('WidgetA.svelte');
    const b = byFile('WidgetB.svelte');
    expect(a, 'expected a key resolving to WidgetA.svelte').toBeDefined();
    expect(b, 'expected a key resolving to WidgetB.svelte').toBeDefined();
    expect(a![0]).not.toBe(b![0]);
  });

  test('each page fetches its own island component, not the other', async () => {
    let server: Server<undefined> | undefined;
    try {
      server = await Mochi.serve({
        port: 0,
        development: false,
        warmup: false,
        logger: { enabled: false },
        outDir,
        routes: { '/': Mochi.page(PAGE_A), '/p1': Mochi.page(PAGE_B) },
      });
      const base = `http://localhost:${server.port}`;

      // Drive the endpoint exactly like the ServerIsland web component would: pull
      // the `component-name` + signed-props token straight off each page's wrapper.
      const islandOf = async (pagePath: string) => {
        const html = await (await fetch(`${base}${pagePath}`)).text();
        const wrapper = html.match(/<mochi-server-island\b[^>]*>/)?.[0];
        if (!wrapper) {
          throw new Error(`no server-island wrapper on ${pagePath}`);
        }
        const name = wrapper.match(/component-name="([^"]+)"/)![1]!;
        const token = wrapper.match(/signed-props="([^"]+)"/)![1]!;
        const res = await fetch(`${base}/_mochi/island/${name}?props=${encodeURIComponent(token)}`);
        return { name, status: res.status, body: await res.text() };
      };

      const a = await islandOf('/');
      const b = await islandOf('/p1');

      // Distinct keys reach the endpoint...
      expect(a.name).not.toBe(b.name);

      // ...and each renders ITS OWN component with ITS OWN props — no cross-render.
      expect(a.status).toBe(200);
      expect(a.body).toContain('WIDGET-A:from-a');
      expect(a.body).not.toContain('WIDGET-B');

      expect(b.status).toBe(200);
      expect(b.body).toContain('WIDGET-B:from-b');
      expect(b.body).not.toContain('WIDGET-A');
    } finally {
      server?.stop(true);
    }
  });
});
