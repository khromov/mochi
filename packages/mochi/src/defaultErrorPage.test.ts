// Previously .isolated.test.ts — all tests now run in isolated processes.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';

const DEFAULT_ERROR_PAGE_PATH = new URL('./templates/DefaultError.svelte', import.meta.url).pathname;

describe('default error page', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    // Must live inside the package so bare `svelte/*` imports in the compiled
    // SSR output resolve against the framework's own node_modules.
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-err-test-'));
    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(DEFAULT_ERROR_PAGE_PATH);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('renders status and message', async () => {
    const result = await registry.renderComponent(DEFAULT_ERROR_PAGE_PATH, {
      error: { status: 404, message: 'Not Found' },
    });
    expect(result.body).toContain('404');
    expect(result.body).toContain('Not Found');
    expect(result.head).toContain('<title>404 Not Found</title>');
  });

  test('omits stack when not provided', async () => {
    const result = await registry.renderComponent(DEFAULT_ERROR_PAGE_PATH, {
      error: { status: 500, message: 'Boom' },
    });
    expect(result.body).not.toContain('class="stack');
  });

  test('renders stack when provided', async () => {
    const stack = 'Error: boom\n    at foo (file.ts:1:1)';
    const result = await registry.renderComponent(DEFAULT_ERROR_PAGE_PATH, {
      error: { status: 500, message: 'Boom', stack },
    });
    expect(result.body).toContain('at foo (file.ts:1:1)');
  });

  test('escapes HTML in the message', async () => {
    const result = await registry.renderComponent(DEFAULT_ERROR_PAGE_PATH, {
      error: { status: 400, message: '<script>alert(1)</script>' },
    });
    expect(result.body).not.toContain('<script>alert(1)');
    expect(result.body).toContain('&lt;script');
  });
});
