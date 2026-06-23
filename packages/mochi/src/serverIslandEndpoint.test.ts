// Boots a real Mochi.serve() and exercises the server-island endpoint
// end-to-end: `islandId` is transport-only (it rides inside the signed props
// envelope, stripped before the component renders), `idPrefix` namespaces the
// standalone render's `$props.id()` off that envelope id, incompatible legacy
// ids (containing `--`, which Svelte rejects as an idPrefix) skip namespacing
// instead of failing, and the `mochi:defer mochi:hydrate` path carries the
// namespaced id into the hydratable wrapper the client re-fetches.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { parse as devalueParse, stringify as devalueStringify } from 'devalue';
import { Mochi } from './Mochi';
import { signProps, verifyAndDecodeProps } from './serverIslandCrypto';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'server-island-endpoint', 'Page.svelte');

describe('server island endpoint', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  let islandId: string;
  let token: string;
  let pageWrapper: string;

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
    // the only thing on the wrapper is the signed-props token. The island id is
    // no longer a separate attribute — it lives inside the signed envelope, so
    // recover it the same way the endpoint does (verify + devalue-parse).
    const html = await (await fetch(`${base}/`)).text();
    const wrapper = html.match(/<mochi-server-island\b[^>]*>/)?.[0];
    if (!wrapper) {
      throw new Error('fixture page did not render a <mochi-server-island> wrapper');
    }
    pageWrapper = wrapper;
    token = wrapper.match(/signed-props="([^"]+)"/)![1]!;
    const decoded = verifyAndDecodeProps(token);
    if (!decoded) {
      throw new Error('could not verify the page wrapper signed-props token');
    }
    islandId = (devalueParse(decoded) as { islandId: string }).islandId;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('the page wrapper carries no island-id attribute', () => {
    expect(pageWrapper).not.toContain('island-id=');
    expect(pageWrapper).toContain('signed-props=');
  });

  test('strips islandId from props and namespaces $props.id() with the envelope id', async () => {
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

  // `mochi:defer mochi:hydrate`: the client (ServerIsland.ts) re-fetches with
  // `hydrate=eager`, so the endpoint wraps the render in a hydratable island.
  // The namespaced `$props.id()` must survive into that wrapper — the client's
  // `hydrate()` reads the id back from the SSR `<!--$…-->` marker, so a prefixed
  // server id is exactly what hydrates, keeping it collision-free with the host.
  test('also-hydrate wraps the namespaced render in a hydratable island', async () => {
    const res = await fetch(`${base}/_mochi/island/Echo?props=${encodeURIComponent(token)}&hydrate=eager`);
    expect(res.status).toBe(200);
    const body = await res.text();

    // Wrapped for client hydration — but with no redundant island-id attribute;
    // the id lives in the SSR `<!--$…-->` markers the client hydrates against.
    expect(body).toContain('<mochi-hydratable-island');
    expect(body).not.toContain('island-id=');

    // The id the client will hydrate against is still prefixed by the envelope id.
    const uid = body.match(/data-uid="([^"]+)"/)![1]!;
    expect(uid.startsWith(`${islandId}-`)).toBe(true);
  });

  // CSS the host page never linked (here a side-effect import; in practice also
  // hydratable descendants rendered only in deferred content) ships as <link>
  // tags inside the response — the browser loads them when the client assigns
  // the HTML via innerHTML. The island's own scoped CSS is excluded; it loads
  // via the wrapper's `css-url` attribute.
  test('injects <link> tags for CSS the host page did not link', async () => {
    const props = signProps(devalueStringify({ islandId: 's-css-0' }));
    const res = await fetch(`${base}/_mochi/island/StyledLeaf?props=${encodeURIComponent(props)}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<link rel="stylesheet"');
    expect(body).toContain('leafStyles');
    // The own scoped CSS is delivered via css-url, not duplicated as a body link.
    expect(body).not.toContain('/css/StyledLeaf-');
  });

  test('a CSS-less server island injects no <link>', async () => {
    const res = await fetch(`${base}/_mochi/island/Echo?props=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain('<link rel="stylesheet"');
  });
});
