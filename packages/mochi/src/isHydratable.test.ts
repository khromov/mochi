// Previously .isolated.test.ts — all tests now run in isolated processes.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { requestContext } from './requestContext';
import type { MochiRequestContext } from './requestContext';
import { MochiCookieJar } from './cookies';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'island-context', 'Page.svelte');

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

describe('isHydratable() context propagation', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-island-context-'));
    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(FIXTURE_PAGE);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('context reaches the island root AND its nested non-directive child, not the plain sibling', async () => {
    const result = await requestContext.run(makeCtx(), () => registry.renderComponent(FIXTURE_PAGE));

    // Page renders: <Probe mochi:hydrate nest/> (root + nested child) then a
    // plain <Probe/>. Root and nested child read true; the plain sibling false.
    const matches = [...result.body.matchAll(/data-hydratable="(true|false)"/g)].map((m) => m[1]);
    expect(matches).toEqual(['true', 'true', 'false']);
  });
});
