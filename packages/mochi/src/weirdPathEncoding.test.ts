import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './compiler/ComponentRegistry';
import { requestContext } from './runtime/requestContext';
import { MochiCookieJar } from './runtime/cookies';

// Encoding regression: the install path may contain characters that are special in
// URLs/import specifiers (`#`, spaces). CI runs in a clean path, so nothing else
// exercises this. We build + render + client-bundle an island fixture from a directory
// whose name deliberately contains `#` and a space, covering every path→specifier hop:
//   - Bun.build entrypoints (the `.svelte` sources)
//   - the dynamic `freshImport` of the built `.server.js` (must pathToFileURL-encode `#`)
//   - the embedded `toPosixPath(resolvedPath)` specifiers in the generated client bundle
//   - the browser-facing asset URLs (must NOT leak the absolute install path)
describe('weird characters in the install path (# and space)', () => {
  // The temp dir lives under packages/mochi so bare imports (`svelte`) resolve via the
  // project's node_modules; the `#`/space are the point of the test.
  let dir: string;
  let registry: ComponentRegistry;
  let page: string;

  const render = () => {
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
    return requestContext.run(ctx, () => registry.renderComponent(page));
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-we#rd dir-'));
    page = path.join(dir, 'Page.svelte');
    writeFileSync(path.join(dir, 'Probe.svelte'), '<span data-testid="probe">PROBE_RENDERED</span>\n');
    writeFileSync(page, `<script lang="ts">\n  import Probe from './Probe.svelte';\n</script>\n\n<section>\n  <Probe mochi:hydrate />\n</section>\n`);
    registry = new ComponentRegistry({ development: true, outDir: path.join(dir, '.mochi') });
    await registry.compile(page);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('renders SSR from the `#`/space directory', async () => {
    const result = await render();
    expect(result.body).toContain('PROBE_RENDERED');
  });

  test('builds the client bundle (embedded specifiers with `#`/space resolve)', async () => {
    const result = await render();
    // The page hydrates an island, so a bootstrap bundle + per-component entry exist.
    expect(result.bootstrapUrl).toBeTruthy();
    const stats = registry.getClientStats();
    expect(stats).not.toBeNull();
    expect(stats!.outputs.length).toBeGreaterThan(0);
  });

  test('asset URLs are well-formed and never leak the install path', async () => {
    const result = await render();
    const urls = [result.bootstrapUrl, ...result.cssUrls].filter((u): u is string => Boolean(u));
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.startsWith('/')).toBe(true);
      expect(url).not.toContain('\\');
      expect(url).not.toContain('#');
      expect(url).not.toContain(' ');
      // Neither the raw nor the percent-encoded temp path should appear in a public URL.
      expect(url).not.toContain(path.basename(dir));
      expect(url).not.toContain(encodeURIComponent(path.basename(dir)));
    }
  });
});
