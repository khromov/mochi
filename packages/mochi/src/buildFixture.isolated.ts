// Runs Mochi's production `build()` for a fixture page in a standalone process.
//
// The manifest-precompile tests need a real build, but `build()` performs two
// `compileAll` passes (pages, then server islands) in one process. Once the SSR
// bundle transitively pulls in `@noble/ciphers` (server-island props are
// encrypted), a second `compileAll` in the same process trips a Bun bundler
// EISDIR bug reading `@noble/ciphers/aes.js`. A real `mochi-framework build`
// doesn't hit this (it's a fresh process), so tests spawn this script via
// `bun run` to get the same clean-process behavior instead of calling `build()`
// inline. Named `.isolated.ts` so it's excluded from the `*.test.ts` glob.
import path from 'node:path';
import { build } from './build';
import { Mochi } from './Mochi';

/**
 * Spawn this file as a `bun run` subprocess to precompile `fixturePage` into
 * `outDir`'s manifest, isolating the build's `compileAll` passes from the
 * caller's process. Throws with the child's stderr on failure.
 */
export async function runIsolatedBuild(fixturePage: string, outDir: string): Promise<void> {
  const proc = Bun.spawn(['bun', 'run', import.meta.path, fixturePage, outDir], {
    cwd: path.join(import.meta.dir, '..'),
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
  const [fixturePage, outDir] = process.argv.slice(2);
  if (!fixturePage || !outDir) {
    console.error('usage: bun run buildFixture.isolated.ts <fixturePage> <outDir>');
    process.exit(2);
  }
  await build({
    routes: { '/': Mochi.page(fixturePage) },
    development: false,
    outDir,
  });
}
