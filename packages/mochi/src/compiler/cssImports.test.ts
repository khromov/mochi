import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { encodeSourcePath } from './manifestPaths';

const FIXTURE_DIR = path.join(import.meta.dir, '..', '__fixtures__', 'css-imports');
const FIXTURE_PAGE = path.join(FIXTURE_DIR, 'Page.svelte');
const FIXTURE_CSS = path.join(FIXTURE_DIR, 'styles.css');
const FIXTURE_MISSING_PAGE = path.join(FIXTURE_DIR, 'MissingPage.svelte');
const FIXTURE_BAD_CSS_PAGE = path.join(FIXTURE_DIR, 'BadCssPage.svelte');

describe('CSS imports — happy path', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-css-import-test-'));
    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(FIXTURE_PAGE);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('strips the CSS import from the SSR JS bundle', () => {
    // SSR outputs are hashed, so resolve the on-disk path via the manifest
    // rather than reconstructing it from the source basename.
    const ssrModulePath = registry.toManifest().components[encodeSourcePath(FIXTURE_PAGE)]!.ssrModule;
    const ssrSource = readFileSync(path.resolve(outDir, ssrModulePath), 'utf8');
    expect(ssrSource).not.toContain('color: red');
    expect(ssrSource).not.toContain('styles.css');
  });

  test('records the CSS path in entryImportedCss for the page', () => {
    const manifest = registry.toManifest();
    const entryCss = manifest.entryImportedCss?.[encodeSourcePath(FIXTURE_PAGE)];
    expect(entryCss).toBeDefined();
    expect(entryCss).toContain(encodeSourcePath(FIXTURE_CSS));
  });

  test('getClientStats() includes the bundled CSS as an output', () => {
    const stats = registry.getClientStats();
    expect(stats).not.toBeNull();
    const cssOutput = stats?.outputs.find((o) => o.name.startsWith('styles-'));
    expect(cssOutput).toBeDefined();
    expect(cssOutput?.size).toBeGreaterThan(0);
  });

  test('renderComponent links the bundled CSS URL', async () => {
    const { requestContext } = await import('../runtime/requestContext');
    const { MochiCookieJar } = await import('../runtime/cookies');
    const ctx = {
      requestId: 'test',
      request: new Request('http://localhost/'),
      url: new URL('http://localhost/'),
      params: {},
      locals: {},
      isWarmup: false,
      cookies: new MochiCookieJar(null),
      islandProps: new Map(),
      getClientAddress: () => null,
    };
    const result = await requestContext.run(ctx, () => registry.renderComponent(FIXTURE_PAGE));
    const importCssUrl = result.cssUrls.find((u) => u.includes('/import-css/styles-'));
    expect(importCssUrl).toBeDefined();
  });

  // Also the idempotence check for the source-path codec: a manifest that
  // survives encode → decode → encode unchanged proves the two halves agree.
  test('manifest round-trip preserves importedCssUrls and entryImportedCss', async () => {
    const manifest = registry.toManifest();
    const json = JSON.parse(JSON.stringify(manifest));
    const manifestPath = path.join(outDir, 'manifest.json');
    await Bun.write(manifestPath, JSON.stringify(json));
    const restored = await ComponentRegistry.fromManifest(manifestPath, false);
    const restoredManifest = restored.toManifest();
    expect(restoredManifest.importedCssUrls).toEqual(manifest.importedCssUrls);
    expect(restoredManifest.entryImportedCss).toEqual(manifest.entryImportedCss);
  });
});

describe('CSS imports — variable-font format() preservation', () => {
  let outDir: string;
  let registry: ComponentRegistry;
  const FIXTURE_FONT_PAGE = path.join(FIXTURE_DIR, 'FontPage.svelte');

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-css-import-font-'));
    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(FIXTURE_FONT_PAGE);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  // Bun's CSS bundler unquotes `format('woff2-variations')` to `format(woff2-variations)`,
  // which is invalid CSS and causes the browser to silently drop the @font-face src.
  // The framework re-quotes it after bundling.
  test('preserves quoted format() value for woff2-variations', () => {
    const stats = registry.getClientStats();
    const cssOutput = stats?.outputs.find((o) => o.name.startsWith('font-'));
    expect(cssOutput).toBeDefined();
    const cssUrl = `/_mochi/import-css/${cssOutput!.name}`;
    const cssText = registry.getClientFile(cssUrl);
    expect(cssText).toBeDefined();
    expect(cssText).toContain("format('woff2-variations')");
    expect(cssText).not.toMatch(/\bformat\(woff2-variations\)/);
  });
});

describe('CSS imports — error path', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(() => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-css-import-err-'));
    registry = new ComponentRegistry({ development: true, outDir });
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('a missing CSS import causes the SSR build to throw', async () => {
    await expect(registry.compile(FIXTURE_MISSING_PAGE)).rejects.toThrow();
  });

  test('a bundle-failed CSS import is recorded as a css-bundle-failed error', async () => {
    await registry.compile(FIXTURE_BAD_CSS_PAGE);
    const cssErrors = registry.getErrors().filter((e) => e.kind === 'css-bundle-failed');
    expect(cssErrors.length).toBeGreaterThan(0);
  });
});
