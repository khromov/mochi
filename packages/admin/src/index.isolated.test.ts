import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from 'mochi-framework';
import { routes } from './routes';

describe('admin template', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    // Pages `import './styles/app.generated.css'`, so the file must exist for the
    // import to resolve when a page compiles. In dev/build it's produced by
    // scripts/prebuild.ts (compileTailwind); the SSR assertions below only check
    // markup, not styles, so if the prebuild hasn't run we just create an empty
    // file. This keeps the hook fast — compileTailwind loads the oxide native
    // binding and can exceed the default hook timeout on a slow/contended box.
    const generatedCss = path.join(import.meta.dir, 'styles', 'app.generated.css');
    if (!existsSync(generatedCss)) {
      writeFileSync(generatedCss, '');
    }

    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-admin-test-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      htmlShell: './src/shell.html',
      trailingSlash: 'always',
      routes,
    });
    base = `http://localhost:${server.port}`;
  }, 30_000); // Mochi.serve() startup can exceed the default 5s hook timeout on a slow/contended box.

  afterAll(() => {
    server?.stop(true);
    if (outDir) {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  // First fetch to each route triggers on-demand SSR compilation, so give the
  // tests headroom over the default 5s per-test timeout.
  test('GET /login/ renders the sign-in page', async () => {
    const res = await fetch(`${base}/login/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Sign in');
  }, 15_000);

  test('GET / renders the dashboard', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Dashboard');
  }, 15_000);

  test('GET /health reports ok', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  test('GET /products/ lists seeded products', async () => {
    const res = await fetch(`${base}/products/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('MOCH-PRO');
  }, 15_000);
});
