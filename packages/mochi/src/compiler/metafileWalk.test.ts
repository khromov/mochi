import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { encodeSourcePath } from './manifestPaths';
import { requestContext } from '../runtime/requestContext';
import { MochiCookieJar } from '../runtime/cookies';

// Two-hop import chain that exercises the metafile walk's transitive
// attribution: Page → Wrapper → { Deep.svelte (component CSS), deep.css
// (side-effect import) }. Page and Wrapper carry no `<style>`, so any CSS
// the page renders must come from the deep node — i.e. the walk has to
// reach two imports past the entry. A regression in Bun's metafile shape
// (or in our walk) that drops transitive nodes will surface here.

const FIXTURE_DIR = path.join(import.meta.dir, '..', '__fixtures__', 'metafile-walk');
const FIXTURE_PAGE = path.join(FIXTURE_DIR, 'Page.svelte');
const FIXTURE_DEEP_CSS = path.join(FIXTURE_DIR, 'deep.css');

describe('metafile walk — transitive attribution at depth 2', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-metafile-walk-'));
    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(FIXTURE_PAGE);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('attributes a side-effect .css import reached two imports deep', () => {
    const manifest = registry.toManifest();
    const entryCss = manifest.entryImportedCss?.[encodeSourcePath(FIXTURE_PAGE)];
    expect(entryCss).toBeDefined();
    expect(entryCss).toContain(encodeSourcePath(FIXTURE_DEEP_CSS));
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
    expect(result.cssUrls).toHaveLength(2);
    const deepComponentCss = result.cssUrls.filter((u) => u.startsWith('/_mochi/css/Deep-'));
    expect(deepComponentCss).toHaveLength(1);
    expect(deepComponentCss[0]).toMatch(/^\/_mochi\/css\/Deep-[a-z0-9]+\.css$/);
    const deepImportedCss = result.cssUrls.filter((u) => u.startsWith('/_mochi/import-css/deep-'));
    expect(deepImportedCss).toHaveLength(1);
    expect(deepImportedCss[0]).toMatch(/^\/_mochi\/import-css\/deep-[a-z0-9]+\.css$/);
  });
});
