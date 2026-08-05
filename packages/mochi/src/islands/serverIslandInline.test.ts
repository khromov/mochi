// Boots a real Mochi.serve() and exercises nested-island inlining end-to-end: an island-endpoint render expands
// nested `mochi:defer` call sites in-process (one fetch returns the whole chain), while page SSR, `:visible`
// children, `inline: false` opt-outs, hydrating parents, and budget-exhausted recursion all keep the classic
// fetch placeholder — and every placeholder that survives carries a token the endpoint accepts.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { parse as devalueParse } from 'devalue';
import { Mochi } from '../Mochi';
import { decryptProps } from './serverIslandCrypto';
import { DEFAULT_INLINE_BUDGET } from './inlineServerIslands';

const FIXTURE_PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'inline-islands', 'Page.svelte');

interface Wrapper {
  tag: string;
  key: string;
  token: string;
}

function harvestWrappers(html: string): Wrapper[] {
  return [...html.matchAll(/<mochi-server-island\b[^>]*>/g)].map((m) => ({
    tag: m[0],
    key: m[0].match(/component-name="([^"]+)"/)![1]!,
    token: m[0].match(/signed-props="([^"]+)"/)![1]!,
  }));
}

describe('nested server island inlining', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  let pageWrappers: Wrapper[];

  const wrapperFor = (prefix: string): Wrapper => {
    const w = pageWrappers.find((w) => new RegExp(`^${prefix}_\\w+$`).test(w.key));
    if (!w) {
      throw new Error(`fixture page did not render a <mochi-server-island> wrapper for ${prefix}`);
    }
    return w;
  };

  const fetchIsland = async (w: Wrapper): Promise<string> => {
    const res = await fetch(`${base}/_mochi/island/${w.key}?props=${encodeURIComponent(w.token)}`);
    expect(res.status).toBe(200);
    return res.text();
  };

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-inline-'));
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
    pageWrappers = harvestWrappers(await (await fetch(`${base}/`)).text());
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('page SSR keeps every top-level island deferred', () => {
    // The first hop stays a fetch — only island-endpoint renders inline.
    for (const prefix of ['Chain', 'OptOutChain', 'ThrowChain', 'Recursive', 'DeepHydrateTop']) {
      expect(wrapperFor(prefix).tag).toContain('signed-props=');
    }
    expect(pageWrappers.some((w) => w.key.startsWith('Child_'))).toBe(false);
  });

  test('one island fetch returns the whole nested chain inline', async () => {
    const body = await fetchIsland(wrapperFor('Chain'));

    // Child and its own nested GrandChild arrive in the same response — no fetch placeholders for them.
    expect(body).toContain('data-marker="chain"');
    expect(body).toContain('data-marker="child"');
    expect(body).toContain('data-marker="grandchild"');
    expect(body).not.toContain('data-marker="child-fallback"');

    const leftover = harvestWrappers(body);
    expect(leftover.some((w) => w.key.startsWith('Child_'))).toBe(false);
    expect(leftover.some((w) => w.key.startsWith('GrandChild_'))).toBe(false);
  });

  test('a conditional child inlines when its branch rendered', async () => {
    // `cond` rode inside Chain's sealed props as `true`, so the `{#if cond}` site rendered and inlined.
    expect(await fetchIsland(wrapperFor('Chain'))).toContain('data-marker="cond-child"');
  });

  test('a :visible child keeps its lazy placeholder with a working token', async () => {
    const body = await fetchIsland(wrapperFor('Chain'));
    const visible = harvestWrappers(body).find((w) => w.key.startsWith('VisibleChild_'));
    expect(visible).toBeDefined();
    expect(visible!.tag).toContain('defer-on="visible"');
    expect(body).not.toContain('data-marker="visible-child"');

    expect(await fetchIsland(visible!)).toContain('data-marker="visible-child"');
  });

  test('an inlined also-hydrate child ships the endpoint-shaped hydratable wrapper and bootstrap', async () => {
    const body = await fetchIsland(wrapperFor('Chain'));

    // Server-rendered inline, wrapped for client hydration with the props attribute the endpoint would have emitted.
    expect(body).toContain('data-marker="ah-child"');
    expect(body).toContain('hydrate me: 0');
    const wrapper = body.match(/<mochi-hydratable-island\b[^>]*>/)![0];
    expect(wrapper).toContain('component-name="AlsoHydrateChild_');
    expect(wrapper).toContain('props="');
    expect(wrapper).toContain('component-url="');
    expect(wrapper).not.toContain('__MOCHI_COMPONENT_URL__');
    expect(body).toMatch(/<script type="module" src="[^"]+"><\/script>/);
  });

  test('inline: false keeps the placeholder and its token fetches end-to-end', async () => {
    const body = await fetchIsland(wrapperFor('OptOutChain'));

    expect(body).toContain('data-marker="optout-chain"');
    expect(body).toContain('data-marker="optout-fallback"');
    expect(body).not.toContain('data-marker="optout-child"');

    const child = harvestWrappers(body).find((w) => w.key.startsWith('OptOutChild_'));
    expect(child).toBeDefined();
    // Token byte-compat guard for the `{...__mochi_props__}` envelope: the sealed token decrypts against the
    // child's identity key and carries the transport id.
    const decoded = devalueParse(decryptProps(child!.token, child!.key)!) as Record<string, unknown>;
    expect(typeof decoded.islandId).toBe('string');
    expect(await fetchIsland(child!)).toContain('data-marker="optout-child"');
  });

  test('a throwing inlined child degrades to the placeholder, whose fetch returns the failure stub', async () => {
    const body = await fetchIsland(wrapperFor('ThrowChain'));

    // Parent content rendered; the boundary's `failed` snippet emitted the classic placeholder with fallback children.
    expect(body).toContain('data-marker="throw-chain"');
    expect(body).toContain('data-marker="throw-fallback"');
    expect(body).not.toContain('data-marker="throwing"');

    const child = harvestWrappers(body).find((w) => w.key.startsWith('Throwing_'));
    expect(child).toBeDefined();
    // The follow-up fetch fails deterministically, so the endpoint answers 200 with the known stub.
    expect(await fetchIsland(child!)).toContain('mochi-island-failure');
  });

  test('recursion stops at the inline budget and completes with a placeholder', async () => {
    const body = await fetchIsland(wrapperFor('Recursive'));

    // The endpoint render is depth 0; each nested expansion consumes budget, so depths 1..BUDGET inline.
    const depths = [...body.matchAll(/data-depth="(\d+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...depths)).toBe(DEFAULT_INLINE_BUDGET);
    expect(depths).toHaveLength(DEFAULT_INLINE_BUDGET + 1);

    const leftover = harvestWrappers(body);
    expect(leftover).toHaveLength(1);
    expect(leftover[0]!.key.startsWith('Recursive_')).toBe(true);
  });

  test('an also-hydrate island render never inlines nested defer sites', async () => {
    // DeepHydrateTop hydrates client-side, so its render is not armed: the defer grandchild (two files deep,
    // past the shallow defer-in-hydratable guard) must stay a fetch placeholder to match the client bundle.
    const body = await fetchIsland(wrapperFor('DeepHydrateTop'));

    expect(body).toContain('data-marker="middle"');
    expect(body).not.toContain('data-marker="grandchild"');
    expect(harvestWrappers(body).some((w) => w.key.startsWith('GrandChild_'))).toBe(true);
  });
});
