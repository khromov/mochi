// Two renderComponent calls in ONE request context must not cross-contaminate
// their island-props blocks. renderComponent clears ctx.islandProps at the start
// of every render, so the second render's HTML carries only its own payload
// (regression for the removed "delete only the entries this render emitted"
// workaround). Models the sequential same-ctx cases: error page after a failed
// render, an action's POST re-render.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { requestContext } from '../runtime/requestContext';
import type { MochiRequestContext } from '../runtime/requestContext';
import { MochiCookieJar } from '../runtime/cookies';

const PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'sequential-render', 'Page.svelte');

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

describe('sequential renders in one request context', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-sequential-render-'));
    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(PAGE);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test("second render's props block contains only its own payload", async () => {
    const second = await requestContext.run(makeCtx(), async () => {
      await registry.renderComponent(PAGE, { label: 'first-render' });
      return registry.renderComponent(PAGE, { label: 'second-render' });
    });

    // Exactly one props block, carrying the second render's payload only.
    const blocks = [...second.body.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)];
    expect(blocks).toHaveLength(1);
    expect(blocks[0]![1]).toContain('second-render');
    expect(blocks[0]![1]).not.toContain('first-render');
    // Fresh id numbering — the map was cleared, so it starts at 0 again.
    expect(second.body).toContain('id="mochi-props-0"');
  });
});
