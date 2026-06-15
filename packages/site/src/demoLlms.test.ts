import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from 'mochi-framework';
import { internalDemoLlmsRoutes } from './lib/docs';
import { routes } from './routes';

// Boots the real site routes so the per-demo llms.txt routes are exercised against
// the actual router — this is what catches collisions like /demos/data-loading/:id
// shadowing /demos/data-loading/llms.txt.
describe('per-demo llms.txt routes', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-demo-llms-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes,
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  const demoRoutes = internalDemoLlmsRoutes();

  test('there is at least one internal demo', () => {
    expect(demoRoutes.length).toBeGreaterThan(0);
  });

  test.each(demoRoutes.map((r) => [r.path, r.slug] as const))('%s serves the demo source as text/plain', async (path, slug) => {
    const res = await fetch(`${base}${path}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain(`## Demo: ${slug}`);
    expect(text).toContain('```');
    // Guard against a demo page route (HTML) shadowing the llms.txt route.
    expect(text).not.toContain('<!doctype html>');
  });

  test('/llms.json lists every internal demo, and each url is a registered route', async () => {
    const res = await fetch(`${base}/llms.json`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { docs: { url: string }[]; demos: { title: string; url: string }[] };
    expect(body.demos.length).toBe(demoRoutes.length);
    const registeredPaths = new Set(demoRoutes.map((r) => r.path));
    for (const demo of body.demos) {
      expect(demo.url).toMatch(/\/llms\.txt$/);
      expect(registeredPaths.has(new URL(demo.url).pathname)).toBe(true);
    }
  });

  test('per-demo source path tracks the demo page path, not a fixed /demos/ prefix', async () => {
    // The Cookie Vary demo lives at /cookie-vary-test/ (top-level), so its source must
    // sit next to it — not under /demos/.
    const aligned = await fetch(`${base}/cookie-vary-test/llms.txt`);
    expect(aligned.status).toBe(200);
    expect(await aligned.text()).toContain('## Demo: cookie-vary-test');

    const stale = await fetch(`${base}/demos/cookie-vary-test/llms.txt`);
    expect(stale.status).toBe(404);
  });

  test('unknown demo llms.txt 404s', async () => {
    const res = await fetch(`${base}/demos/does-not-exist/llms.txt`);
    expect(res.status).toBe(404);
  });

  test('/llms-full.txt bundles the same per-demo source as the per-demo route', async () => {
    const [full, perDemo] = await Promise.all([fetch(`${base}/llms-full.txt`).then((r) => r.text()), fetch(`${base}/cookie-vary-test/llms.txt`).then((r) => r.text())]);
    // Cross-folder files (index.ts from the shared demoIndex example) must appear in the
    // full bundle too, proving both paths read from the same per-demo files registry.
    expect(full).toContain('## Demo: cookie-vary-test');
    expect(full).toContain('### index.ts');
    // The per-demo section is embedded verbatim in the full bundle.
    expect(full).toContain(perDemo.trimEnd());
  });

  test('/llms-full.txt strips demo <style> blocks but keeps docs styles and per-demo styles', async () => {
    // .chat-input button:hover lives only in the chat demo's ChatWidget.svelte <style>.
    const demoCss = '.chat-input button:hover';
    const [full, perDemo] = await Promise.all([fetch(`${base}/llms-full.txt`).then((r) => r.text()), fetch(`${base}/demos/chat/llms.txt`).then((r) => r.text())]);
    // Per-demo route keeps the demo's real styles.
    expect(perDemo).toContain(demoCss);
    // The chat demo is bundled into the full output, but its <style> block is
    // replaced with an empty placeholder rather than shipping the CSS.
    expect(full).toContain('## Demo: chat');
    expect(full).not.toContain(demoCss);
    expect(full).toContain('<style>\n  /* Styles omitted */\n</style>');
    // Docs <style> examples (e.g. the Card example in 155-css-imports.md) are preserved.
    expect(full).toContain('color: tomato;');
  });

  test('hello-world demo source matches snapshot', async () => {
    const text = await fetch(`${base}/demos/hello-world/llms.txt`).then((r) => r.text());
    expect(text).toMatchSnapshot();
  });

  test('cookie-vary-test demo source matches snapshot', async () => {
    const text = await fetch(`${base}/cookie-vary-test/llms.txt`).then((r) => r.text());
    expect(text).toMatchSnapshot();
  });

  test('includes cross-folder files declared via loadSources (not just the demo folder)', async () => {
    const res = await fetch(`${base}/demos/shared-state/llms.txt`);
    const text = await res.text();
    // likes.svelte.ts lives in src/stores, outside the shared-state folder.
    expect(text).toContain('### likes.svelte.ts');
    expect(text).toContain('### index.ts');
    expect(text).toContain('### SharedState.svelte');
  });

  test('/llms.txt is a standard llms.txt index, not the concatenated bundle', async () => {
    const res = await fetch(`${base}/llms.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text.startsWith('# Mochi')).toBe(true);
    expect(text).toContain('\n> ');
    expect(text).toContain('## Docs');
    expect(text).toContain('## Examples');
    expect(text).toContain('## Optional');
    expect(text).toMatch(/\]\([^)]*\/docs\/[^/]+\/llms\.txt\):/);
    expect(text).toMatch(/\]\([^)]*\/demos\/[^/]+\/llms\.txt\):/);
    expect(text).toContain('/llms-recommended.txt');
    expect(text).toContain('/llms-full.txt');
    // The index is just links — not the raw docs with their fenced code blocks.
    expect(text).not.toContain('```');
  });

  test('/llms-recommended.txt serves the concatenated docs', async () => {
    const res = await fetch(`${base}/llms-recommended.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    // Full docs in reading order — substantial, and not the index format.
    expect(text.length).toBeGreaterThan(5000);
    expect(text.startsWith('# Mochi\n')).toBe(false);
  });
});
