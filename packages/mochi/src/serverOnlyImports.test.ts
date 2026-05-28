// Previously .isolated.test.ts — all tests now run in isolated processes.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { requestContext } from './requestContext';
import { MochiCookieJar } from './cookies';

const FIXTURE_DIR = path.join(import.meta.dir, '__fixtures__', 'server-only');
const FIXTURE_PAGE = path.join(FIXTURE_DIR, 'Page.svelte');
const SENTINEL = 'sentinel-from-server-module-d3adb33f';

describe('.server.ts imports', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-server-only-test-'));
    registry = new ComponentRegistry({ development: false, outDir });
    await registry.compile(FIXTURE_PAGE);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('SSR renders the value returned by the .server.ts module', async () => {
    const ctx = {
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
    const result = await requestContext.run(ctx, () => registry.renderComponent(FIXTURE_PAGE));
    expect(result.body).toContain(`parsed:${SENTINEL}`);
  });

  test('client bundle does not contain the .server.ts module body', () => {
    const clientFiles = registry.getClientFiles();
    const clientSources = [...clientFiles.entries()].filter(([url]) => url.endsWith('.js')).map(([, src]) => src);
    expect(clientSources.length).toBeGreaterThan(0);
    for (const src of clientSources) {
      expect(src).not.toContain(SENTINEL);
    }
  });

  test('client bundle emits the throwing stub error message', () => {
    const clientFiles = registry.getClientFiles();
    const joined = [...clientFiles.entries()]
      .filter(([url]) => url.endsWith('.js'))
      .map(([, src]) => src)
      .join('\n');
    expect(joined).toContain('server-only export');
  });
});
