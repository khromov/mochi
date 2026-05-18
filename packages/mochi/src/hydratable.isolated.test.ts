import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';

// `*.isolated.test.ts` runs in its own `bun test` invocation: this test boots
// a ComponentRegistry, and compiling the same Svelte entrypoint twice in one
// bun:test process trips a Bun bundler EISDIR bug. See CLAUDE.md "Testing".

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'hydratable', 'Page.svelte');

describe('hydratable round-trip', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-hydratable-test-'));
    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(FIXTURE_PAGE);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('renders the value into body and emits a lookup script in head', async () => {
    const result = await registry.renderComponent(FIXTURE_PAGE);

    expect(result.body).toContain('42');
    expect(result.body).toContain('frozen-on-server');

    expect(result.head).toContain('<script');
    expect(result.head).toContain('window.__svelte');
    expect(result.head).toContain('mochi-test:val');
    expect(result.head).toContain('frozen-on-server');
  });
});
