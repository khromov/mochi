// A `mochi:hydrate` island rendered only inside a server island's deferred
// content is gated out of the host page's <head> (it isn't rendered at page
// time), so its CSS must travel with the island render. The endpoint injects
// `<link>` tags for `renderComponent().cssUrls` into the response (see
// serverIslandEndpoint.test.ts for that wiring); this file asserts that
// `cssUrls` actually collects a nested hydratable child's CSS.
//
// Driven through ComponentRegistry rather than Mochi.serve: building the child's
// *client* bundle alongside a second build in the same process trips a Bun
// bundler EISDIR/Unseekable bug under `bun test`. `cssUrls` is collected during
// SSR, so a single registry build exercises the real path without that hazard.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { requestContext } from './requestContext';
import type { MochiRequestContext } from './requestContext';
import { MochiCookieJar } from './cookies';

const STYLED_SERVER = path.join(import.meta.dir, '__fixtures__', 'server-island-endpoint', 'StyledServer.svelte');
const ECHO = path.join(import.meta.dir, '__fixtures__', 'server-island-endpoint', 'Echo.svelte');

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

describe('server island CSS collection', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-island-css-'));
    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(STYLED_SERVER);
    await registry.compile(ECHO);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('cssUrls includes a nested hydratable child plus the island itself', async () => {
    const result = await requestContext.run(makeCtx(), () => registry.renderComponent(STYLED_SERVER));
    const joined = result.cssUrls.join(',');
    expect(joined).toContain('StyledChild-');
    expect(joined).toContain('StyledServer-');
  });

  test('a CSS-less island yields no cssUrls (so the endpoint omits the header)', async () => {
    const result = await requestContext.run(makeCtx(), () => registry.renderComponent(ECHO, { name: 'x' }));
    expect(result.cssUrls).toHaveLength(0);
  });
});
