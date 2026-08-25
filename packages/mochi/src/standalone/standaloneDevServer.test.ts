import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startStandaloneDevServer, type StandaloneDevServerHandle } from './devServer';
import { resolveSvelteCompiler } from '../compiler/svelteCompilerBackend';
import { Mochi } from '../Mochi';

const appDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-standalone-dev-'));
const originalCwd = process.cwd();
let handle: StandaloneDevServerHandle;
let base: string;

describe('standalone dev server', () => {
  beforeAll(async () => {
    mkdirSync(path.join(appDir, 'src'), { recursive: true });
    mkdirSync(path.join(appDir, 'public'), { recursive: true });
    writeFileSync(path.join(appDir, 'src', 'Home.svelte'), `<h1>Dev home</h1>\n`);
    writeFileSync(
      path.join(appDir, 'src', 'app.ts'),
      `import { Mochi } from 'mochi-framework';
await Mochi.standalone({ routes: { '/': Mochi.page('./src/Home.svelte') } });
`,
    );
    writeFileSync(path.join(appDir, 'public', 'hello.txt'), 'hi from public\n');
    process.chdir(appDir);

    handle = await startStandaloneDevServer({
      options: { port: 0, routes: { '/': Mochi.page('./src/Home.svelte') }, logger: { level: 'error' } },
      entryPath: path.join(appDir, 'src', 'app.ts'),
      backend: await resolveSvelteCompiler(undefined),
      userCompilerOptions: {},
    });
    base = `http://localhost:${handle.server.port}`;
  });

  afterAll(async () => {
    await handle.stop();
    process.chdir(originalCwd);
    rmSync(appDir, { recursive: true, force: true });
  });

  test('serves the app shell at / with the live-reload client inlined', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('<div id="mochi-app"></div>');
    expect(html).toContain('<mochi-live-reload></mochi-live-reload>');
  });

  test('serves the same shell for deep links (hash routing)', async () => {
    const res = await fetch(`${base}/todos/42`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<div id="mochi-app"></div>');
  });

  test('serves the built entry script referenced by the shell', async () => {
    const html = await (await fetch(`${base}/`)).text();
    const match = html.match(/src="\.\/(standalone-app-[^"]+\.js)"/);
    expect(match).not.toBeNull();
    const res = await fetch(`${base}/${match![1]}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('registerRouteComponent');
  });

  test('serves publicDir files', async () => {
    const res = await fetch(`${base}/hello.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('hi from public');
  });

  test('accepts a live-reload websocket and greets with the boot generation', async () => {
    const ws = new WebSocket(`ws://localhost:${handle.server.port}/__mochi_live_reload`);
    const greeting = await new Promise<string>((resolve, reject) => {
      ws.onmessage = (event) => resolve(String(event.data));
      ws.onerror = () => reject(new Error('websocket error'));
    });
    expect(greeting).toStartWith('boot:');
    ws.close();
  });
});
