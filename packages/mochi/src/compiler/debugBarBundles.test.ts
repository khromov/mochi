import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { requestContext } from '../runtime/requestContext';
import { MochiCookieJar } from '../runtime/cookies';

// PageB's two islands both import `heavyOnlyOnB.ts`, so code splitting hoists it into a chunk
// that only PageB's entries import. PageA renders an island of its own, so it still gets the
// shared Svelte-runtime chunk — the debug bar must report that one and not PageB's.
const FIXTURE_DIR = path.join(import.meta.dir, '..', '__fixtures__', 'debug-bar-bundles');
const PAGE_A = path.join(FIXTURE_DIR, 'PageA.svelte');
const PAGE_B = path.join(FIXTURE_DIR, 'PageB.svelte');

const renderWithDebugBar = (entry: string) =>
  requestContext.run(
    {
      requestId: 'test',
      request: new Request('http://localhost/'),
      url: new URL('http://localhost/'),
      params: {},
      locals: {},
      isWarmup: false,
      cookies: new MochiCookieJar(null),
      islandProps: new Map(),
      getClientAddress: () => null,
      debugBarData: { route: '/', pathname: '/', params: {} },
    },
    () => registry.renderComponent(entry),
  );

let outDir: string;
let registry: ComponentRegistry;

describe('debug bar bundle list — chunk reachability', () => {
  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-debug-bar-bundles-'));
    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compileAll([PAGE_A, PAGE_B]);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test("omits a chunk none of the page's islands import", async () => {
    const result = await renderWithDebugBar(PAGE_A);
    const bundles = result.debugBarData?.bundles ?? [];

    expect(bundles.some((b) => b.kind === 'island')).toBe(true);
    expect(bundles.some((b) => b.kind === 'chunk')).toBe(true);
    expect(bundles.flatMap((b) => b.inputs ?? []).some((i) => i.path.includes('heavyOnlyOnB'))).toBe(false);
  });

  test("keeps a chunk the page's islands do import", async () => {
    const result = await renderWithDebugBar(PAGE_B);
    const bundles = result.debugBarData?.bundles ?? [];

    const heavyChunk = bundles.find((b) => b.kind === 'chunk' && (b.inputs ?? []).some((i) => i.path.includes('heavyOnlyOnB')));
    expect(heavyChunk).toBeDefined();
  });
});
