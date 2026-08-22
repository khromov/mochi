import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from '../compiler/ComponentRegistry';
import { HYDRATABLE_CONTEXT_KEY } from '../islands/isHydratable';

const FIXTURES = path.join(import.meta.dir, '..', '__fixtures__', 'script');
const PAGE = path.join(FIXTURES, 'Page.svelte');
const MULTI_PAGE = path.join(FIXTURES, 'MultiPage.svelte');
const COMPONENT = path.join(import.meta.dir, 'Script.server.svelte');

describe('<Script>', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-script-test-'));
    registry = new ComponentRegistry({ development: true, outDir });
    // Batch every entrypoint into one build: separate client builds in a single
    // process trip Bun's bundler EISDIR bug on shared transitive deps.
    await registry.compileAll([PAGE, MULTI_PAGE, COMPONENT]);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('emits a module script that dynamically imports the bundled URL', async () => {
    const { body } = await registry.renderComponent(PAGE);

    // Placeholder token is gone; a real hashed client URL took its place.
    expect(body).not.toContain('__MOCHI_SCRIPT_URL__');
    const m = body.match(/<script type="module">import\("(\/_mochi\/client\/[^"]+\.js)"\);<\/script>/);
    expect(m).not.toBeNull();

    // The referenced bundle is actually served, and contains the transpiled source.
    const url = m![1]!;
    const file = registry.getClientFile(url);
    expect(file).toBeDefined();
    expect(file).toContain('hello from bundled script');
  });

  test('scripts={[…]} bundles and imports each path', async () => {
    const { body } = await registry.renderComponent(MULTI_PAGE);
    const imports = [...body.matchAll(/import\("(\/_mochi\/client\/[^"]+\.js)"\)/g)].map((x) => x[1]!);
    expect(imports).toHaveLength(2);
    for (const url of imports) {
      expect(registry.getClientFile(url)).toBeDefined();
    }
  });

  test('refuses to hydrate', async () => {
    const context = new Map<unknown, unknown>([[HYDRATABLE_CONTEXT_KEY, true]]);
    await expect(registry.renderComponent(COMPONENT, { __mochiScriptUrls: ['/x.js'] }, { context })).rejects.toThrow('must not be hydrated');
  });

  test('throws when used without a resolvable static path', async () => {
    await expect(registry.renderComponent(COMPONENT, {})).rejects.toThrow('static');
  });

  test('serializes script URLs into the manifest', async () => {
    const manifest = registry.toManifest();
    expect(manifest.scriptEntryUrls).toBeDefined();
    const urls = Object.values(manifest.scriptEntryUrls!);
    // snippet.ts (shared by both pages) + other.ts = two distinct bundles.
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(url).toMatch(/^\/_mochi\/client\/.+\.js$/);
      expect(manifest.clientFiles[url]).toBeDefined();
    }
  });
});
