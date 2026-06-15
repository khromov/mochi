import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from 'mochi-framework';
import { internalDemoSlugs } from './lib/docs';
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

  const slugs = internalDemoSlugs();

  test('there is at least one internal demo', () => {
    expect(slugs.length).toBeGreaterThan(0);
  });

  test.each(slugs)('/demos/%s/llms.txt serves the demo source as text/plain', async (slug) => {
    const res = await fetch(`${base}/demos/${slug}/llms.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain(`## Demo: ${slug}`);
    expect(text).toContain('```');
    // Guard against a demo page route (HTML) shadowing the llms.txt route.
    expect(text).not.toContain('<!doctype html>');
  });

  test('/llms.json lists every internal demo with a working llms.txt url', async () => {
    const res = await fetch(`${base}/llms.json`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { docs: { url: string }[]; demos: { title: string; url: string }[] };
    expect(body.demos.length).toBe(slugs.length);
    for (const demo of body.demos) {
      expect(demo.url).toMatch(/\/demos\/[^/]+\/llms\.txt$/);
    }
  });

  test('unknown demo llms.txt 404s', async () => {
    const res = await fetch(`${base}/demos/does-not-exist/llms.txt`);
    expect(res.status).toBe(404);
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
