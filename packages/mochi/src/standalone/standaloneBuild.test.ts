import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runStandalone } from './standalone';
import { Mochi } from '../Mochi';
import type { MochiPageConfig } from '../types';

// Inside packages/mochi (two levels up from src/standalone/), so the bundle resolves node_modules through the project tree.
const appDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-standalone-build-'));
const originalCwd = process.cwd();

function writeApp(): void {
  mkdirSync(path.join(appDir, 'src'), { recursive: true });
  mkdirSync(path.join(appDir, 'public'), { recursive: true });
  writeFileSync(
    path.join(appDir, 'src', 'Widget.svelte'),
    `<script>
  let { label } = $props();
</script>
<p class="widget">{label}</p>
<style>.widget { color: rebeccapurple; }</style>
`,
  );
  writeFileSync(
    path.join(appDir, 'src', 'Home.svelte'),
    `<script lang="ts">
  import Widget from './Widget.svelte';
  const title: string = 'Standalone home';
</script>
<h1>{title}</h1>
<Widget mochi:hydrate label="stripped island" />
`,
  );
  writeFileSync(
    path.join(appDir, 'src', 'app.ts'),
    `import { Mochi } from 'mochi-framework';
await Mochi.standalone({
  development: false,
  routes: { '/': Mochi.page('./src/Home.svelte') },
});
`,
  );
  writeFileSync(path.join(appDir, 'public', 'robots.txt'), 'User-agent: *\n');
}

describe('standalone static build', () => {
  beforeAll(() => {
    writeApp();
    // Per-file test isolation makes chdir safe, and it mirrors real usage: componentPath strings resolve against the app root.
    process.chdir(appDir);
  });

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(appDir, { recursive: true, force: true });
  });

  test('emits index.html plus relative-path JS, with directives stripped', async () => {
    await runStandalone(
      {
        development: false,
        routes: { '/': Mochi.page('./src/Home.svelte') },
        logger: { level: 'error' },
      },
      { entryPath: path.join(appDir, 'src', 'app.ts') },
    );

    const distDir = path.join(appDir, 'dist');
    const html = readFileSync(path.join(distDir, 'index.html'), 'utf8');
    expect(html).toContain('<div id="mochi-app"></div>');
    expect(html).toMatch(/<script type="module" src="\.\/standalone-app-[^"]+\.js"><\/script>/);
    expect(html).not.toContain('\\');
    expect(html).not.toContain('mochi-live-reload');

    const files = readdirSync(distDir);
    const jsFiles = files.filter((f) => f.endsWith('.js'));
    expect(jsFiles.length).toBeGreaterThanOrEqual(1);
    for (const js of jsFiles) {
      const contents = readFileSync(path.join(distDir, js), 'utf8');
      expect(contents).not.toContain('mochi:hydrate');
    }
    // The stripped island renders as a plain component — its label string ships in the client bundle.
    expect(jsFiles.some((js) => readFileSync(path.join(distDir, js), 'utf8').includes('stripped island'))).toBe(true);

    expect(readFileSync(path.join(distDir, 'robots.txt'), 'utf8')).toContain('User-agent');
    expect(existsSync(path.join(distDir, 'index.html'))).toBe(true);
  });

  test('rejects serverProps on a standalone route', async () => {
    await expect(
      runStandalone({ development: false, routes: { '/': Mochi.page('./src/Home.svelte', { serverProps: { a: 1 } }) } }, { entryPath: path.join(appDir, 'src', 'app.ts') }),
    ).rejects.toThrow('serverProps');
  });

  test('rejects non-page route values', async () => {
    // Deliberately defeats the type system — the runtime validation is the thing under test.
    const apiRoute = Mochi.api(() => new Response('no')) as unknown as MochiPageConfig;
    await expect(runStandalone({ development: false, routes: { '/api': apiRoute } }, { entryPath: path.join(appDir, 'src', 'app.ts') })).rejects.toThrow('Mochi.page()');
  });

  test('rejects wildcard patterns', async () => {
    await expect(runStandalone({ development: false, routes: { '/files/*': Mochi.page('./src/Home.svelte') } }, { entryPath: path.join(appDir, 'src', 'app.ts') })).rejects.toThrow(
      'wildcard',
    );
  });

  test('rejects an empty route table', async () => {
    await expect(runStandalone({ development: false, routes: {} }, { entryPath: path.join(appDir, 'src', 'app.ts') })).rejects.toThrow('at least one route');
  });

  test('rejects clientProps on the loading page', async () => {
    await expect(
      runStandalone(
        {
          development: false,
          routes: { '/': Mochi.page('./src/Home.svelte') },
          loading: Mochi.page('./src/Widget.svelte', { clientProps: () => ({}) }),
        },
        { entryPath: path.join(appDir, 'src', 'app.ts') },
      ),
    ).rejects.toThrow('loading');
  });
});
