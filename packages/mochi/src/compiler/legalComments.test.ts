import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { buildInlineWebComponent } from './buildInlineWebComponent';

const PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'legal-comments', 'Page.svelte');
const CLASSIC = './__fixtures__/legal-comments/classic.ts';
const BANNER = 'legal-comments-fixture v1';

let outDirs: string[] = [];
let savedEnv: string | undefined;

async function islandJs(minifier: 'bun' | 'oxc'): Promise<string> {
  const outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', `.mochi-legal-comments-${minifier}-`));
  outDirs.push(outDir);
  const registry = new ComponentRegistry({ development: false, debugBar: false, outDir, minifier });
  await registry.compileAll([PAGE]);
  return [...registry.getClientFiles()]
    .filter(([url]) => url.endsWith('.js'))
    .map(([, code]) => code)
    .join('\n');
}

describe('legal comments', () => {
  beforeAll(() => {
    // Both modes are picked here; an inherited MOCHI_MINIFIER would override the constructor option.
    savedEnv = process.env.MOCHI_MINIFIER;
    delete process.env.MOCHI_MINIFIER;
  });

  afterAll(() => {
    if (savedEnv !== undefined) {
      process.env.MOCHI_MINIFIER = savedEnv;
    }
    for (const dir of outDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    outDirs = [];
  });

  test("island chunks keep a dependency's banner under 'bun' and drop it under 'oxc'", async () => {
    expect(await islandJs('bun')).toContain(BANNER);

    const oxc = await islandJs('oxc');
    expect(oxc).not.toContain(BANNER);
    expect(oxc).toContain('hello ');
  });

  test("inline classic scripts keep the banner under 'bun' and drop it under 'oxc'", async () => {
    expect(await buildInlineWebComponent(CLASSIC, 'bun')).toContain(BANNER);

    const oxc = await buildInlineWebComponent(CLASSIC, 'oxc');
    expect(oxc).not.toContain(BANNER);
    expect(oxc).toContain('legalFixture');
  });
});
