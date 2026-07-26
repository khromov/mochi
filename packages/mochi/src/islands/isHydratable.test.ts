// Previously .isolated.test.ts — all tests now run in isolated processes.
import { afterAll, beforeAll, describe, expect, spyOn, test, type Mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from '../compiler/ComponentRegistry';
import { requestContext } from '../runtime/requestContext';
import type { MochiRequestContext } from '../runtime/requestContext';
import { MochiCookieJar } from '../runtime/cookies';
import { logger } from '../utils/log';
import { HYDRATABLE_CONTEXT_KEY } from './isHydratable';

const FIXTURE_PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'island-context', 'Page.svelte');
const FIXTURE_PROBE = path.join(import.meta.dir, '..', '__fixtures__', 'island-context', 'Probe.svelte');
const FIXTURE_SPREAD = path.join(import.meta.dir, '..', '__fixtures__', 'island-context', 'SpreadProbe.svelte');
const FIXTURE_LEGACY = path.join(import.meta.dir, '..', '__fixtures__', 'island-context', 'LegacyProbe.svelte');
const FIXTURE_AMBIGUOUS_PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'island-context', 'AmbiguousRootPage.svelte');

const HYDRATABLE_CONTEXT = new Map<unknown, unknown>([[HYDRATABLE_CONTEXT_KEY, true]]);

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

describe('isHydratable() context', () => {
  let outDir: string;
  let registry: ComponentRegistry;
  let warnSpy: Mock<typeof logger.warn>;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-island-context-'));
    registry = new ComponentRegistry({ development: true, outDir });
    warnSpy = spyOn(logger, 'warn');
    // One compileAll for all entrypoints — avoids a double in-process
    // Bun.build() (see bunfig.toml).
    await registry.compileAll([FIXTURE_PAGE, FIXTURE_PROBE, FIXTURE_SPREAD, FIXTURE_LEGACY, FIXTURE_AMBIGUOUS_PAGE]);
  });

  afterAll(() => {
    warnSpy.mockRestore();
    rmSync(outDir, { recursive: true, force: true });
  });

  test('no framework prop is injected', async () => {
    const result = await requestContext.run(makeCtx(), () => registry.renderComponent(FIXTURE_PAGE));

    // `isHydratable` is a plain user prop — undefined on both invocations.
    const matches = [...result.body.matchAll(/data-hydratable="(true|false)"/g)].map((m) => m[1]);
    expect(matches).toEqual(['false', 'false']);
  });

  test('a user-passed `isHydratable` prop flows through untouched, independent of the context signal', async () => {
    // `isHydratable` has no framework meaning as a prop name: passing it
    // reaches the component verbatim, while isHydratable() still reports the
    // absence of the context seed.
    const result = await requestContext.run(makeCtx(), () => registry.renderComponent(FIXTURE_PROBE, { isHydratable: true }));

    expect([...result.body.matchAll(/data-hydratable="(true|false)"/g)].map((m) => m[1])).toEqual(['true']);
    expect([...result.body.matchAll(/data-ctx="(true|false)"/g)].map((m) => m[1])).toEqual(['false']);
  });

  test('isHydratable() propagates through the island subtree: nested child and snippet child true, outside false', async () => {
    const result = await requestContext.run(makeCtx(), () => registry.renderComponent(FIXTURE_PAGE));

    // Order in the SSR output: island Probe's internal CtxProbe, the snippet
    // child passed from the page, the plain Probe's internal CtxProbe, the
    // page-level sibling after the island.
    const matches = [...result.body.matchAll(/data-ctx="(true|false)"/g)].map((m) => m[1]);
    expect(matches).toEqual(['true', 'true', 'false', 'false']);
  });

  test('standalone render with the hydratable context (also-hydrate server island path) seeds nested context', async () => {
    // The `/_mochi/island/:name` endpoint renders the island component
    // directly, passing `context` only for `mochi:defer mochi:hydrate`.
    const alsoHydrate = await requestContext.run(makeCtx(), () => registry.renderComponent(FIXTURE_PROBE, {}, { context: HYDRATABLE_CONTEXT }));
    expect([...alsoHydrate.body.matchAll(/data-ctx="(true|false)"/g)].map((m) => m[1])).toEqual(['true']);

    const pureDefer = await requestContext.run(makeCtx(), () => registry.renderComponent(FIXTURE_PROBE, {}));
    expect([...pureDefer.body.matchAll(/data-ctx="(true|false)"/g)].map((m) => m[1])).toEqual(['false']);
  });

  test('identifier-form $props() root: spreads stay clean and the subtree sees context', async () => {
    const result = await requestContext.run(makeCtx(), () => registry.renderComponent(FIXTURE_SPREAD, { title: 'hello' }, { context: HYDRATABLE_CONTEXT }));

    expect(result.body).toContain('title="hello"');
    expect([...result.body.matchAll(/data-ctx="(true|false)"/g)].map((m) => m[1])).toEqual(['true']);
  });

  test('legacy island root: $$restProps stays clean and the subtree sees context', async () => {
    const result = await requestContext.run(makeCtx(), () => registry.renderComponent(FIXTURE_LEGACY, { label: 'x', extra: 'y' }, { context: HYDRATABLE_CONTEXT }));

    expect(result.body).toContain('extra="y"');
    expect([...result.body.matchAll(/data-ctx="(true|false)"/g)].map((m) => m[1])).toEqual(['true']);
  });

  test('a mode-ambiguous island root just works: context reaches its subtree with no warning', async () => {
    // Under the old script-grafting seed pass this root was declined (its mode
    // couldn't be classified) and a compile-time warning fired. The boundary
    // component seeds context from the render site, so the root's script mode
    // is irrelevant.
    const result = await requestContext.run(makeCtx(), () => registry.renderComponent(FIXTURE_AMBIGUOUS_PAGE));

    expect([...result.body.matchAll(/data-ctx="(true|false)"/g)].map((m) => m[1])).toEqual(['true']);
    const warning = warnSpy.mock.calls.flat().find((a): a is string => typeof a === 'string' && a.includes('isHydratable'));
    expect(warning).toBeUndefined();
  });
});
