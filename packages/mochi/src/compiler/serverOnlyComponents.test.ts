import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { registerServerOnlyComponentStubs } from './serverOnlyComponents';
import { CLIENT_BUILD_DEFINE } from './serverOnlyModuleGuard';
import { ComponentRegistry } from './ComponentRegistry';

const SRC_DIR = path.resolve(import.meta.dir, '..');

describe('registerServerOnlyComponentStubs (unit)', () => {
  const tmpDir = mkdtempSync(path.join(SRC_DIR, '..', '.mochi-ssr-only-unit-'));
  afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

  test('a *.server.svelte import is replaced by a throwing stub, its body never compiled', async () => {
    const marker = 'ssr-only-body-marker-9f3c2a';
    writeFileSync(path.join(tmpDir, 'Widget.server.svelte'), `<h1>${marker}</h1>\n`);
    const entry = path.join(tmpDir, 'entry.ts');
    writeFileSync(entry, `import Widget from './Widget.server.svelte';\nexport default Widget;\n`);

    const result = await Bun.build({
      entrypoints: [entry],
      plugins: [{ name: 'stub', setup: registerServerOnlyComponentStubs }],
      target: 'browser',
      define: { ...CLIENT_BUILD_DEFINE },
      throw: false,
    });

    expect(result.success).toBe(true);
    const out = await result.outputs[0]!.text();
    // The stub is emitted; the component markup is never reached (no svelte compile ran).
    expect(out).toContain('server-only export');
    expect(out).not.toContain(marker);
  });
});

const FIXTURE_PAGE = path.join(SRC_DIR, '__fixtures__', 'ssr-only-barrel', 'Page.svelte');

describe('SSR-only components stay out of island client bundles (integration)', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-ssr-only-barrel-'));
    registry = new ComponentRegistry({ development: false, outDir });
    await registry.compile(FIXTURE_PAGE);
  });

  afterAll(() => rmSync(outDir, { recursive: true, force: true }));

  test('client bundle drops the barrel-pulled ViewTransitions/RawScript but keeps MochiCaptcha', () => {
    const joined = [...registry.getClientFiles().entries()]
      .filter(([url]) => url.endsWith('.js'))
      .map(([, src]) => src)
      .join('\n');

    // RawScript's `node:fs` import is the definitive server-only telltale — present before the fix, gone after.
    expect(joined).not.toContain('readFileSync');
    // The real interactive island (imported from the same barrel) still ships.
    expect(joined).toContain('captcha-hint');
  });
});
