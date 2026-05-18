import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { mochiEvents } from './events';

// `*.isolated.test.ts` runs in its own `bun test` invocation:
// compiling the same Svelte entrypoint twice in one bun:test process trips a
// Bun bundler EISDIR bug, and other tests already compile via Mochi.serve().
// See CLAUDE.md "Testing" for details.
import type { MochiIslandErrorEvent } from './events';
import { requestContext } from './requestContext';
import type { MochiRequestContext } from './requestContext';
import { MochiCookieJar } from './cookies';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'boundary', 'Page.svelte');

function makeCtx(): MochiRequestContext {
  return {
    requestId: 'test',
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
    params: {},
    locals: {},
    cookies: new MochiCookieJar(null),
    islandProps: new Map(),
    getClientAddress: () => null,
  };
}

describe('island error boundaries', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    // mkdtemp inside the package so bare `svelte/*` imports in the compiled
    // SSR output resolve against the framework's own node_modules.
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-boundary-test-'));
    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(FIXTURE_PAGE);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('healthy islands render and the throwing one is replaced by <mochi-island-failure>', async () => {
    const result = await requestContext.run(makeCtx(), () => registry.renderComponent(FIXTURE_PAGE));

    // Both healthy islands render their content.
    expect(result.body).toContain('healthy:alpha');
    expect(result.body).toContain('healthy:omega');

    // The throwing island is replaced by the failure stub.
    expect(result.body).toContain('<mochi-island-failure');
    expect(result.body).toContain('data-component="Throwing"');

    // The thrown message text leaks through (dev mode).
    expect(result.body).toContain('boundary-fixture: ssr throw');

    // The thrown component's literal child must NOT have made it into the output.
    expect(result.body).not.toContain('unreachable');
  });

  test('emits island:error when an island throws during SSR', async () => {
    const events: MochiIslandErrorEvent[] = [];
    const handler = (event: MochiIslandErrorEvent) => {
      events.push(event);
    };
    mochiEvents.on('island:error', handler);
    try {
      await requestContext.run(makeCtx(), () => registry.renderComponent(FIXTURE_PAGE));
    } finally {
      mochiEvents.off('island:error', handler);
    }

    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.kind === 'hydratable')).toBe(true);
    expect(events.some((e) => e.message.includes('boundary-fixture: ssr throw'))).toBe(true);
  });
});
