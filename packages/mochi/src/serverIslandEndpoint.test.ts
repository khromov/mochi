// Boots a real Mochi.serve() and exercises the server-island endpoint
// end-to-end: `islandId` is transport-only (stripped before the component
// renders), `idPrefix` namespaces the standalone render's `$props.id()` off
// the wrapper's island-id, and incompatible legacy ids (containing `--`,
// which Svelte rejects as an idPrefix) skip namespacing instead of failing.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { stringify as devalueStringify } from 'devalue';
import { Mochi } from './Mochi';
import { signProps } from './serverIslandCrypto';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'server-island-endpoint', 'Page.svelte');

describe('server island endpoint', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  let islandId: string;
  let token: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-island-endpoint-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {
        '/': Mochi.page(FIXTURE_PAGE),
      },
    });
    base = `http://localhost:${server.port}`;

    // Drive the endpoint exactly like the ServerIsland web component would:
    // pull island-id and the signed-props token off the page's wrapper element.
    const html = await (await fetch(`${base}/`)).text();
    const wrapper = html.match(/<mochi-server-island\b[^>]*>/)?.[0];
    if (!wrapper) {
      throw new Error('fixture page did not render a <mochi-server-island> wrapper');
    }
    islandId = wrapper.match(/island-id="([^"]+)"/)![1]!;
    token = wrapper.match(/signed-props="([^"]+)"/)![1]!;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('strips islandId from props and namespaces $props.id() with the wrapper id', async () => {
    const res = await fetch(`${base}/_mochi/island/Echo?props=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    const body = await res.text();

    // The component received only the user prop — islandId never reaches it.
    expect(body).toContain('data-prop-keys="name"');
    expect(body).toContain('>World<');

    // idPrefix namespacing: ids minted inside the standalone render hang off
    // the wrapper's island-id, so they cannot collide with host-page ids.
    const uid = body.match(/data-uid="([^"]+)"/)![1]!;
    expect(uid.startsWith(`${islandId}-`)).toBe(true);
  });

  test('islandId containing `--` skips namespacing instead of failing the render', async () => {
    const legacy = signProps(devalueStringify({ islandId: 'mochi--legacy-0', name: 'Legacy' }));
    const res = await fetch(`${base}/_mochi/island/Echo?props=${encodeURIComponent(legacy)}`);
    expect(res.status).toBe(200);
    const body = await res.text();

    // Render succeeded (no failure stub) with an un-prefixed Svelte id.
    expect(body).not.toContain('mochi-island-failure');
    expect(body).toContain('>Legacy<');
    const uid = body.match(/data-uid="([^"]+)"/)![1]!;
    expect(uid).not.toContain('--');
    expect(uid).toMatch(/^s\d+$/);
  });

  test('missing islandId renders un-namespaced rather than failing', async () => {
    const noId = signProps(devalueStringify({ name: 'Bare' }));
    const res = await fetch(`${base}/_mochi/island/Echo?props=${encodeURIComponent(noId)}`);
    expect(res.status).toBe(200);
    const body = await res.text();

    expect(body).not.toContain('mochi-island-failure');
    expect(body).toContain('>Bare<');
    expect(body.match(/data-uid="([^"]+)"/)![1]!).toMatch(/^s\d+$/);
  });
});
