import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { requestContext } from './requestContext';
import { MochiCookieJar } from './cookies';

// Two-hop import chain that exercises the metafile walk's transitive
// attribution: Page → Wrapper → { Deep.svelte (component CSS), deep.css
// (side-effect import) }. Page and Wrapper carry no `<style>`, so any CSS
// the page renders must come from the deep node — i.e. the walk has to
// reach two imports past the entry. A regression in Bun's metafile shape
// (or in our walk) that drops transitive nodes will surface here.

const FIXTURE_DIR = path.join(import.meta.dir, '__fixtures__', 'metafile-walk');
const FIXTURE_PAGE = path.join(FIXTURE_DIR, 'Page.svelte');
const FIXTURE_DEEP_CSS = path.join(FIXTURE_DIR, 'deep.css');

describe('metafile walk — transitive attribution at depth 2', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-metafile-walk-'));
    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(FIXTURE_PAGE);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('attributes a side-effect .css import reached two imports deep', () => {
    const manifest = registry.toManifest();
    const entryCss = manifest.entryImportedCss?.[FIXTURE_PAGE];
    expect(entryCss).toBeDefined();
    expect(entryCss).toContain(FIXTURE_DEEP_CSS);
  });

  test('attributes component CSS for a Svelte file reached two imports deep', async () => {
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
    const deepComponentCss = result.cssUrls.find((u) => u.includes('/css/Deep-'));
    expect(deepComponentCss).toBeDefined();
    const deepImportedCss = result.cssUrls.find((u) => u.includes('/import-css/deep-'));
    expect(deepImportedCss).toBeDefined();
  });
});
