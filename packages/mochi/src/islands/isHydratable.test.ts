// Previously .isolated.test.ts — all tests now run in isolated processes.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from '../compiler/ComponentRegistry';
import { requestContext } from '../runtime/requestContext';
import type { MochiRequestContext } from '../runtime/requestContext';
import { MochiCookieJar } from '../runtime/cookies';

const FIXTURE_PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'island-context', 'Page.svelte');
const FIXTURE_PROBE = path.join(import.meta.dir, '..', '__fixtures__', 'island-context', 'Probe.svelte');

function makeCtx(): MochiRequestContext {
  return {
    requestId: 'test',
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
    params: {},
    locals: {},
    isWarmup: false,
    cookies: new MochiCookieJar(null),
    islandProps: new Map(),
    getClientAddress: () => null,
  };
}

describe('auto-injected `isHydratable` prop', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-island-context-'));
    registry = new ComponentRegistry({ development: true, outDir });
    // One compileAll for both entrypoints: a second Bun.build over the same
    // transitive deps in one process risks the bundler EISDIR bug.
    await registry.compileAll([FIXTURE_PAGE, FIXTURE_PROBE]);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('the public `isHydratable` prop is no longer injected, and the internal transport never leaks into HTML', async () => {
    const result = await requestContext.run(makeCtx(), () => registry.renderComponent(FIXTURE_PAGE));

    // `isHydratable` is a plain user prop now — undefined on both invocations.
    const matches = [...result.body.matchAll(/data-hydratable="(true|false)"/g)].map((m) => m[1]);
    expect(matches).toEqual(['false', 'false']);
    expect(result.body).not.toContain('__mochi_hydratable');
  });

  test('isHydratable() propagates through the island subtree: nested child and snippet child true, outside false', async () => {
    const result = await requestContext.run(makeCtx(), () => registry.renderComponent(FIXTURE_PAGE));

    // Order in the SSR output: island Probe's internal CtxProbe, the snippet
    // child passed from the page, the plain Probe's internal CtxProbe, the
    // page-level sibling after the island.
    const matches = [...result.body.matchAll(/data-ctx="(true|false)"/g)].map((m) => m[1]);
    expect(matches).toEqual(['true', 'true', 'false', 'false']);
  });

  test('standalone render with the envelope transport prop (also-hydrate server island path) seeds nested context', async () => {
    // The `/_mochi/island/:name` endpoint renders the island component
    // directly, passing the decrypted envelope props — which include the
    // internal transport prop only for `mochi:defer mochi:hydrate`.
    const alsoHydrate = await requestContext.run(makeCtx(), () => registry.renderComponent(FIXTURE_PROBE, { __mochi_hydratable: true }));
    expect([...alsoHydrate.body.matchAll(/data-ctx="(true|false)"/g)].map((m) => m[1])).toEqual(['true']);

    const pureDefer = await requestContext.run(makeCtx(), () => registry.renderComponent(FIXTURE_PROBE, {}));
    expect([...pureDefer.body.matchAll(/data-ctx="(true|false)"/g)].map((m) => m[1])).toEqual(['false']);
  });
});
