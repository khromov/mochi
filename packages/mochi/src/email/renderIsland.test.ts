// A hydratable island in an email template is a hard error. Kept in its own
// file with a registry that compiles ONLY the island fixture: building a client
// bundle for an island alongside other fixtures trips the known `bun test`
// EISDIR bundler bug (same rationale as isHydratable.test.ts's single-compile
// registry). A real `mochi-framework build` is unaffected.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from '../ComponentRegistry';
import { renderEmailComponent } from './render';

const WITH_ISLAND = path.join(import.meta.dir, '..', '__fixtures__', 'email', 'WithIsland.svelte');

describe('renderEmailComponent island guard', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-email-island-'));
    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(WITH_ISLAND);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('rejects templates that contain a hydratable island', async () => {
    await expect(renderEmailComponent(registry, WITH_ISLAND, { name: 'Ada' })).rejects.toThrow(/can't contain islands/);
  });
});
