// Runs Mochi's production `build()` for a fixture page in a standalone process.
//
// The manifest-precompile tests need a real build, but `build()` performs two
// `compileAll` passes (pages, then server islands) in one process. Once the SSR
// bundle transitively pulls in `@noble/ciphers` (server-island props are
// encrypted), a second `compileAll` in the same process trips a Bun bundler
// EISDIR bug reading `@noble/ciphers/aes.js`. A real `mochi-framework build`
// doesn't hit this (it's a fresh process), so tests spawn this script via
// `bun run` to get the same clean-process behavior instead of calling `build()`
// inline. Lives under `utils/` (not a `*.test.ts` file) so the test runner never
// executes it directly — it's only ever spawned.
import path from 'node:path';
import { build } from '../cli/build';
import { Mochi } from '../Mochi';

/**
 * Spawn this file as a `bun run` subprocess to precompile `fixturePage` into
 * `outDir`'s manifest, isolating the build's `compileAll` passes from the
 * caller's process. Throws with the child's stderr on failure.
 */

// TODO: This is not a great long-term solution, let's re-evaluate in the future and see if there is
// a better way of doing this.
export async function runIsolatedBuild(fixturePage: string | string[], outDir: string): Promise<void> {
  // Multiple pages mount at `/`, `/p1`, `/p2`, … — enough to exercise cross-page
  // concerns (e.g. two pages that import different components under the same
  // local name) in one build.
  const pages = Array.isArray(fixturePage) ? fixturePage : [fixturePage];
  const proc = Bun.spawn([process.execPath, import.meta.path, outDir, ...pages], {
    // Run from the package root (this file lives in `src/utils/`) so module and
    // svelte resolution behave like a normal `mochi-framework build`.
    cwd: path.join(import.meta.dir, '..', '..'),
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (exitCode !== 0) {
    throw new Error(`isolated build failed (exit ${exitCode}) for ${fixturePage}:\n${stderr}`);
  }
}

if (import.meta.main) {
  const [outDir, ...pages] = process.argv.slice(2);
  if (!outDir || pages.length === 0) {
    console.error('usage: bun run src/utils/runIsolatedBuild.ts <outDir> <fixturePage...>');
    process.exit(2);
  }
  const routes = Object.fromEntries(pages.map((p, i) => [i === 0 ? '/' : `/p${i}`, Mochi.page(p)]));
  await build({
    routes,
    development: false,
    outDir,
  });
}
