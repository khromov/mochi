import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { svelteCompilerBackend } from '@mochi-framework/rsvelte';
import { Mochi } from 'mochi-framework';

const routes = {
  '/': Mochi.page('./src/HelloWorld.svelte'),
};

describe('minimal-rsvelte app', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-minimal-rsvelte-test-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      svelteCompiler: 'rsvelte',
      outDir,
      htmlShell: './src/shell.html',
      routes,
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  // The framework falls back to svelte/compiler without failing, so the binding loading at all is worth asserting on each CI platform.
  test('the rsvelte binding loads on this platform', () => {
    expect(svelteCompilerBackend.name).toBe('rsvelte');
    expect(svelteCompilerBackend.compile('<p>x</p>', { generate: 'server' }).js.code).toContain('$$renderer.push(`<p>x</p>`)');
  });

  test('GET / renders Hello world', async () => {
    const res = await fetch(base);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Hello Mochi via rsvelte!');
  });
});
