import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';

const FIXTURE_DIR = path.join(import.meta.dir, '..', '__fixtures__', 'barrel-split');
const PAGE = path.join(FIXTURE_DIR, 'Page.svelte');

// An island importing `{ MochiCaptcha }` from the `mochi-framework/components` barrel must not drag the barrel's
// SSR-only components (ViewTransitions, RawScript) into the client bundle — the regression behind the captcha demo
// shipping a ViewTransitions chunk.
describe('client bundle splits the framework components barrel', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeEach(() => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-barrel-split-'));
    registry = new ComponentRegistry({ development: true, outDir });
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('only the imported component reaches the client build inputs', async () => {
    await registry.compileAll([PAGE]);
    const inputs = (registry.getClientStats()?.outputs ?? []).flatMap((o) => o.inputs.map((i) => i.path));
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.some((p) => p.includes('MochiCaptcha.svelte'))).toBe(true);
    expect(inputs.some((p) => p.includes('ViewTransitions.svelte'))).toBe(false);
    expect(inputs.some((p) => p.includes('RawScript.svelte'))).toBe(false);
    expect(inputs.some((p) => p.includes('components/index.ts'))).toBe(false);
  });

  test('no emitted chunk carries ViewTransitions code', async () => {
    await registry.compileAll([PAGE]);
    const clientDir = path.join(outDir, 'svelte-client');
    const chunks = readdirSync(clientDir).filter((f) => f.endsWith('.js'));
    expect(chunks.length).toBeGreaterThan(0);
    const texts = chunks.map((f) => readFileSync(path.join(clientDir, f), 'utf8'));
    // Dev-mode compiles embed the source filename, and the hydration guard's message is unique to ViewTransitions.
    expect(texts.some((t) => t.includes('MochiCaptcha.svelte'))).toBe(true);
    for (const text of texts) {
      expect(text).not.toContain('ViewTransitions.svelte');
      expect(text).not.toContain('must not be hydrated');
    }
  });
});
