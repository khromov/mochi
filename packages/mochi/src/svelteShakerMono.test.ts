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

// End-to-end proof that shaking is client-only and that L2 wiring works through
// the real Bun pipeline. The page hydrates an Island rendering the only two call
// sites of Child; L2 specializes both so the `{#if a===1&&b===1}` guard folds
// away and Heavy is tree-shaken out of the *client* bundle. The SSR bundle keeps
// Heavy because the server build always compiles original source.
//
// One `compileAll` per file: re-compiling the same entrypoint in a single
// process trips a Bun bundler EISDIR bug (see scripts/run-tests.ts). The mono-off
// counterpart lives in svelteShakerMonoOff.test.ts.
describe('svelte-shaker: client-only + L2 (mono on)', () => {
  let outDir: string;
  let ssr: string;
  let client: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-mono-on-'));
    const registry = new ComponentRegistry({ development: false, outDir, optimizeWithSvelteShaker: { mono: true } });
    await registry.prepareShake(FIXTURE_DIR);
    await registry.compileAll([PAGE]);
    expect(registry.getErrors()).toEqual([]);
    ssr = readBundle(outDir, 'svelte-compile');
    client = readBundle(outDir, 'svelte-client');
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('SSR bundle keeps Heavy — the server build is never shaken', () => {
    expect(ssr).toContain('HEAVY_MARKER');
  });

  test('L2 drops Heavy from the client bundle', () => {
    expect(client).not.toContain('HEAVY_MARKER');
  });
});
