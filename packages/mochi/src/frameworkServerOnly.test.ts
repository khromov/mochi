// Runs in its own process (per-file isolation) so it doesn't trip the Bun
// bundler EISDIR bug from compiling a second Svelte entrypoint alongside
// serverOnlyImports.test.ts.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'framework-server-only', 'Page.svelte');

// The framework's own server-only exports (MochiCache, cache storage backends)
// are stubbed in the client `mochi-framework` module by scanning their source —
// see serverOnlyFrameworkModules in ComponentRegistry. Guard that wiring here.
describe('server-only framework exports', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-framework-server-only-test-'));
    registry = new ComponentRegistry({ development: false, outDir });
    await registry.compile(FIXTURE_PAGE);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('MochiCache resolves to a server-only stub in the client bundle', () => {
    const joined = [...registry.getClientFiles().entries()]
      .filter(([url]) => url.endsWith('.js'))
      .map(([, src]) => src)
      .join('\n');
    // The generated stub embeds the source module path; the real cache body never ships.
    expect(joined).toContain('mochi-framework/cache.ts');
    expect(joined).toContain('server-only export');
  });
});
