import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// mochi-framework discovers this package through an unanalysable dynamic `import('@mochi-framework/svelte-shaker')`, so
// nothing else in either package's test suite proves the two actually meet. This drives a real `mochi-framework build`
// end to end and asserts the shake ran. The fixture lives inside the package tree because the SSR modules a build emits
// resolve their deps (the framework runtime, @noble/ciphers) relative to the output directory — a /tmp outDir has no
// node_modules chain back to the repo. The build runs in a subprocess so `prepareShake()`'s cwd-relative `./src`
// default can be pointed at the fixture without a `process.chdir()` that would leak across this package's test files.
describe('mochi-framework build with optimize enabled', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  test('loads this package and slims the app', async () => {
    dir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-shaker-e2e-'));
    mkdirSync(path.join(dir, 'src'));
    mkdirSync(path.join(dir, 'public'));
    writeFileSync(
      path.join(dir, 'src', 'Child.svelte'),
      `<script>let { showBadge = false, label } = $props();</script>
{#if showBadge}<span>★</span>{/if}
<strong>{label}</strong>`,
    );
    writeFileSync(
      path.join(dir, 'src', 'Home.svelte'),
      `<script>import Child from './Child.svelte';</script>
<Child label="hello" />
<Child label="world" />`,
    );
    writeFileSync(
      path.join(dir, 'build.ts'),
      `import { Mochi } from 'mochi-framework';
import { build } from 'mochi-framework/build';

await build({
  routes: { '/': Mochi.page('./src/Home.svelte') },
  optimize: { enabled: true },
});`,
    );

    const proc = Bun.spawn(['bun', 'run', 'build.ts'], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    const output = `${stdout}\n${stderr}`;

    expect(exitCode).toBe(0);
    // Proves the optional peer resolved rather than silently degrading to unshaken sources.
    expect(output).toContain('svelte-shaker: svelte-shaker@');
    expect(output).not.toContain('could not be loaded');
    expect(output).not.toContain('optimization skipped');
    // Child.svelte's `showBadge` never varies across its two call sites, so exactly one component changes.
    expect(output).toMatch(/svelte-shaker: slimmed [1-9]\d* of \d+ component\(s\)/);
  }, 120_000);
});
