// `errorPage` was a declared MochiBuildOptions field that the CLI never forwarded off the entry's Mochi.serve() call,
// so a custom error page stayed out of the manifest and was compiled from source the first time an error rendered.
// Only a real CLI run covers that seam — build() itself always honoured the option it was handed.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { MochiManifest } from '../types';

const CLI = path.join(import.meta.dir, 'cli.ts');
const RM_OPTS = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 } as const;

const ENTRY_SRC = `import { Mochi } from 'mochi-framework';

await Mochi.serve({
  port: 0,
  routes: { '/': Mochi.page('./src/Page.svelte') },
  errorPage: './src/Oops.svelte',
});
`;

describe('mochi-framework build forwards errorPage off the entry (subprocess)', () => {
  // Inside the package: the build dynamically imports the SSR modules it emits,
  // and those resolve node_modules from the out-dir.
  let root: string;
  let result: { exitCode: number; stdout: string; stderr: string };
  let manifest: MochiManifest;

  beforeAll(async () => {
    root = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-cli-errorpage-'));
    mkdirSync(path.join(root, 'src'), { recursive: true });
    writeFileSync(path.join(root, 'src', 'index.ts'), ENTRY_SRC);
    writeFileSync(path.join(root, 'src', 'Page.svelte'), '<h1>page</h1>\n');
    writeFileSync(path.join(root, 'src', 'Oops.svelte'), '<h1>custom error</h1>\n');
    // Present only so the build's "no Svelte config" notice stays off stderr,
    // keeping the assertion below a real signal.
    writeFileSync(path.join(root, 'svelte.config.js'), 'export default {};\n');

    const proc = Bun.spawn([process.execPath, CLI, 'build'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
    const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    result = { exitCode, stdout, stderr };
    if (exitCode === 0) {
      manifest = JSON.parse(await Bun.file(path.join(root, '.mochi', 'manifest.json')).text());
    }
  });

  afterAll(() => {
    rmSync(root, RM_OPTS);
  });

  test('the build succeeds', () => {
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  test('the custom error page is in the manifest, not the built-in one', () => {
    const components = Object.keys(manifest.components);
    expect(components).toContain('src/Oops.svelte');
    expect(components).not.toContain('$mochi/templates/DefaultError.svelte');
  });
});
