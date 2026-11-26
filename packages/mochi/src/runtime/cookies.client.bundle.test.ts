import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from '../compiler/ComponentRegistry';

const PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'cookie-jar', 'Page.svelte');
const outDirs: string[] = [];

afterAll(() => {
  for (const dir of outDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function islandJs(development: boolean): Promise<string> {
  const outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-cookie-jar-'));
  outDirs.push(outDir);
  const registry = new ComponentRegistry({ development, debugBar: false, outDir });
  await registry.compileAll([PAGE]);
  return [...registry.getClientFiles()]
    .filter(([url]) => url.endsWith('.js'))
    .map(([, code]) => code)
    .join('\n');
}

test('the browser cookie jar ships its write checks in development builds only', async () => {
  const [dev, prod] = await Promise.all([islandJs(true), islandJs(false)]);
  expect(dev).toContain('had no effect');
  expect(prod).toContain('document.cookie');
  expect(prod).not.toContain('had no effect');
  expect(prod).not.toContain('httpOnly: true');
});
