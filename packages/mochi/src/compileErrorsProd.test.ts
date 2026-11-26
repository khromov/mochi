// Compile errors name source files (a failed CSS bundle carries its absolute path and raw bundler output), so a
// production page render must answer a generic 500 and leave the details to the server log and handleError.
// Separate file because Mochi.serve() is one-per-process.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

describe('compile errors in production', () => {
  let server: Server<undefined>;
  let root: string;
  let status: number;
  let body: string;
  let hookError: unknown;

  beforeAll(async () => {
    root = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-compile-errors-prod-'));
    writeFileSync(path.join(root, 'broken.css'), `@import './does-not-exist.css';\n`);
    writeFileSync(path.join(root, 'Page.svelte'), `<script>\n  import './broken.css';\n</script>\n\n<Missing mochi:hydrate />\n`);
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir: path.join(root, 'out'),
      handleError: ({ error }) => {
        hookError = error;
      },
      routes: { '/': Mochi.page(path.join(root, 'Page.svelte')) },
    });
    const res = await fetch(`http://localhost:${server.port}/`);
    status = res.status;
    body = await res.text();
  });

  afterAll(() => {
    server.stop(true);
    rmSync(root, { recursive: true, force: true });
  });

  test('the page answers a generic 500', () => {
    expect(status).toBe(500);
    expect(body).toContain('Internal Server Error');
  });

  test('the response carries no compile diagnostics or file paths', () => {
    expect(body).not.toContain('compile error');
    expect(body).not.toContain('Unresolved island');
    expect(body).not.toContain('broken.css');
    expect(body).not.toContain(path.basename(root));
  });

  test('handleError still receives the full compile error', () => {
    expect(hookError).toBeInstanceOf(Error);
    expect((hookError as Error).message).toContain('Unresolved island');
    expect((hookError as Error).message).toContain('CSS bundle failed');
  });
});
