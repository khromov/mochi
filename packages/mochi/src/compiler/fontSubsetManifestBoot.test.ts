import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';

const FIXTURE = path.join(import.meta.dir, '..', '__fixtures__', 'fonts', 'caveat-latin-wght-normal.woff2');

// Subsetting is build-time work, so a production boot from a prebuilt manifest must never load the subsetter. This
// process has loaded it to produce the manifest, so the boot runs in a fresh one and reports its module registry.
describe('font subsetting — production boot from a manifest', () => {
  let tmp: string;
  let pagePath: string;
  let manifestPath: string;

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-font-subset-boot-'));
    mkdirSync(path.join(tmp, 'files'));
    copyFileSync(FIXTURE, path.join(tmp, 'files', 'caveat.woff2'));
    writeFileSync(
      path.join(tmp, 'caveat.css'),
      `@font-face {\n  font-family: 'Caveat Variable';\n  font-weight: 400 700;\n  src: url(./files/caveat.woff2) format('woff2-variations');\n}\n`,
    );
    pagePath = path.join(tmp, 'Page.svelte');
    writeFileSync(pagePath, `<script>\n  import './caveat.css' with { subset: "It's animated!" };\n<` + `/script>\n<p>It's animated!</p>\n`);
    const registry = new ComponentRegistry({ development: false, outDir: path.join(tmp, 'out') });
    await registry.compile(pagePath);
    manifestPath = path.join(tmp, 'out', 'manifest.json');
    await Bun.write(manifestPath, JSON.stringify(registry.toManifest()));
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('restoring the registry and rendering the page serves the subset without loading subset-font', () => {
    const bootScript = path.join(tmp, 'boot.ts');
    writeFileSync(
      bootScript,
      [
        `import { ComponentRegistry } from ${JSON.stringify(path.join(import.meta.dir, 'ComponentRegistry.ts'))};`,
        `import { requestContext } from ${JSON.stringify(path.join(import.meta.dir, '..', 'runtime', 'requestContext.ts'))};`,
        `import { MochiCookieJar } from ${JSON.stringify(path.join(import.meta.dir, '..', 'runtime', 'cookies.ts'))};`,
        `const registry = await ComponentRegistry.fromManifest(${JSON.stringify(manifestPath)}, false);`,
        `const ctx = { requestId: 'boot', request: new Request('http://localhost/'), url: new URL('http://localhost/'), params: {}, locals: {}, isWarmup: false, cookies: new MochiCookieJar(null), islandProps: new Map(), getClientAddress: () => null };`,
        `const result = await requestContext.run(ctx, () => registry.renderComponent(${JSON.stringify(pagePath)}));`,
        `const loaded = Object.keys(require.cache).filter((key) => key.includes('subset-font') || key.includes('harfbuzzjs'));`,
        `const font = registry.getFontAsset(result.fontPreloadUrls[0] ?? '');`,
        `console.log(JSON.stringify({ loaded, preloads: result.fontPreloadUrls, subsetOf: font?.subsetOf, body: result.body }));`,
      ].join('\n'),
    );
    const boot = Bun.spawnSync(['bun', bootScript], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
    expect(boot.stderr.toString()).toBe('');
    expect(boot.exitCode).toBe(0);
    const report = JSON.parse(boot.stdout.toString().trim().split('\n').pop()!) as { loaded: string[]; preloads: string[]; subsetOf?: number; body: string };
    expect(report.loaded).toEqual([]);
    expect(report.preloads).toHaveLength(1);
    expect(report.subsetOf).toBe(74932);
    expect(report.body).toContain("It's animated!");
  });
});
