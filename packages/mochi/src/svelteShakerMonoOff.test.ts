import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';

const FIXTURE_DIR = path.join(import.meta.dir, '__fixtures__', 'svelte-shaker-mono');
const PAGE = path.join(FIXTURE_DIR, 'Page.svelte');

function readBundle(outDir: string, sub: string): string {
  const dir = path.join(outDir, sub);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');
}

// Counterpart to svelteShakerMono.test.ts: with L2 off, L1 narrows a and b
// independently and can't prove `a && b` is never both 1, so Heavy survives in
// the client bundle. Separate file = separate process (avoids the Bun EISDIR bug
// from compiling the same entrypoint twice).
describe('svelte-shaker: L1 keeps Heavy (mono off)', () => {
  let outDir: string;
  let client: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-mono-off-'));
    const registry = new ComponentRegistry({ development: false, outDir, optimizeWithSvelteShaker: true });
    await registry.prepareShake(FIXTURE_DIR);
    await registry.compileAll([PAGE]);
    expect(registry.getErrors()).toEqual([]);
    client = readBundle(outDir, 'svelte-client');
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('client bundle keeps Heavy without mono', () => {
    expect(client).toContain('HEAVY_MARKER');
  });
});
