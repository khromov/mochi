import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Subprocess } from 'bun';

// A child process, not an in-process Mochi.serve(): the dev watcher reads its entry from `Bun.main`, so route HMR can
// only be exercised by an app the test actually launches from its own entry file.
describe('route HMR during a dev session', () => {
  let appDir: string;
  let entryFile: string;
  let proc: Subprocess<'ignore', 'pipe', 'pipe'>;
  let base: string;
  let output = '';

  const ROUTES_MARKER = '    // ROUTES';

  const entrySource = (routes: string[]): string =>
    `import { Mochi } from 'mochi-framework';\n` +
    // The regression this guards: the entry-HMR build emitted its JS and its CSS under one extension-less naming
    // template, so any CSS in the entry graph collided and failed the whole build.
    `import './app.css';\n` +
    `\n` +
    `const server = await Mochi.serve({\n` +
    `  port: 0,\n` +
    `  development: true,\n` +
    `  logger: { enabled: false },\n` +
    `  outDir: '.mochi-out',\n` +
    `  trailingSlash: 'always',\n` +
    `  routes: {\n` +
    `    '/': Mochi.page('./src/Page.svelte', { serverProps: () => ({ label: 'home' }) }),\n` +
    routes.map((r) => `    ${r}\n`).join('') +
    `${ROUTES_MARKER}\n` +
    `  },\n` +
    `});\n` +
    `console.log('MOCHI_TEST_PORT=' + server.port);\n`;

  const writeEntry = (routes: string[]) => Bun.write(entryFile, entrySource(routes));

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitFor<T>(probe: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 30_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let last = await probe();
    while (!done(last) && Date.now() < deadline) {
      await sleep(100);
      last = await probe();
    }
    return last;
  }

  const status = async (p: string): Promise<number> => {
    try {
      return (await fetch(base + p, { redirect: 'manual' })).status;
    } catch {
      return 0;
    }
  };

  const body = async (p: string): Promise<string> => {
    try {
      return await (await fetch(base + p)).text();
    } catch {
      return '';
    }
  };

  beforeAll(async () => {
    appDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-dev-route-hmr-'));
    mkdirSync(path.join(appDir, 'src'));
    entryFile = path.join(appDir, 'src', 'index.ts');
    await Bun.write(path.join(appDir, 'src', 'app.css'), 'body { margin: 0; }\n');
    await Bun.write(path.join(appDir, 'src', 'Page.svelte'), `<script lang="ts">\n  let { label = '' } = $props();\n<` + `/script>\n\n<h1>page:{label}</h1>\n`);
    await writeEntry([`'/doomed': Mochi.page('./src/Page.svelte', { serverProps: () => ({ label: 'doomed' }) }),`]);

    proc = Bun.spawn([process.execPath, 'src/index.ts'], {
      cwd: appDir,
      env: { ...process.env, NODE_ENV: 'development' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    void (async () => {
      for await (const chunk of proc.stdout) {
        output += new TextDecoder().decode(chunk);
      }
    })();
    void (async () => {
      for await (const chunk of proc.stderr) {
        output += new TextDecoder().decode(chunk);
      }
    })();

    const port = await waitFor(
      async () => output.match(/MOCHI_TEST_PORT=(\d+)/)?.[1],
      (p) => p !== undefined,
      60_000,
    );
    expect(port, `dev server never reported a port:\n${output}`).toBeDefined();
    base = `http://localhost:${port}`;
    expect(
      await waitFor(
        () => status('/'),
        (s) => s === 200,
        30_000,
      ),
    ).toBe(200);
  }, 90_000);

  afterAll(() => {
    proc?.kill();
    rmSync(appDir, { recursive: true, force: true });
  });

  test('a brand-new route pattern starts serving without a restart', async () => {
    expect(await status('/added/')).toBe(404);

    await Bun.write(path.join(appDir, 'src', 'Added.svelte'), `<h1>added</h1>\n`);
    const src = await Bun.file(entryFile).text();
    await Bun.write(entryFile, src.replace(ROUTES_MARKER, `    '/added': Mochi.page('./src/Added.svelte'),\n${ROUTES_MARKER}`));

    expect(
      await waitFor(
        () => status('/added/'),
        (s) => s === 200,
      ),
    ).toBe(200);
    expect(await body('/added/')).toContain('added');
  }, 60_000);

  test('a new api route registers too, and the trailing-slash mirror follows the route kind', async () => {
    const src = await Bun.file(entryFile).text();
    await Bun.write(entryFile, src.replace(ROUTES_MARKER, `    '/ping': Mochi.api(() => Response.json({ pong: true })),\n${ROUTES_MARKER}`));

    expect(
      await waitFor(
        () => status('/ping'),
        (s) => s === 200,
      ),
    ).toBe(200);
    // Only page routes mirror the alternate slash form.
    expect(await status('/ping/')).toBe(404);
  }, 60_000);

  test('editing an existing route handler swaps it in place', async () => {
    const src = await Bun.file(entryFile).text();
    await Bun.write(entryFile, src.replace(`label: 'home'`, `label: 'home-edited'`));

    expect(
      await waitFor(
        () => body('/'),
        (b) => b.includes('home-edited'),
      ),
    ).toContain('home-edited');
  }, 60_000);

  test('a removed route pattern stops matching', async () => {
    expect(await status('/doomed/')).toBe(200);

    const src = await Bun.file(entryFile).text();
    await Bun.write(
      entryFile,
      src
        .split('\n')
        .filter((line) => !line.includes(`'/doomed'`))
        .join('\n'),
    );

    expect(
      await waitFor(
        () => status('/doomed/'),
        (s) => s === 404,
      ),
    ).toBe(404);
  }, 60_000);
});
