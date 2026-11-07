/**
 * Loader registrations shared by the two client-side `Bun.build`s — the island bundle and the standalone debug bar —
 * so their behavior can't drift.
 */
import path from 'node:path';
import type { PluginBuilder } from 'bun';
import type { CompileOptions } from 'svelte/compiler';
import { renderMochiEnvClient } from './virtualModuleTemplate';
import type { SvelteCompilerBackend } from './svelteCompilerBackend';
import { CLIENT_BUILD_DEFINE } from './serverOnlyModuleGuard';
import { toPosixPath } from '../utils';

const SRC_DIR = path.resolve(import.meta.dir, '..');

// One definition so the island bundle and the tests that assert about it can't drift: `registerEsmEnvStrip` leaves
// DEV/BROWSER/NODE as free identifiers, and these are the literals Bun folds them to.
export function clientBuildDefine(development: boolean): Record<string, string> {
  return {
    DEV: String(development),
    BROWSER: 'true',
    NODE: 'false',
    ...CLIENT_BUILD_DEFINE,
  };
}

// Bun can't propagate constants through esm-env's conditional exports, so stripping the imports turns DEV/BROWSER/NODE
// into free variables that Bun's `define` replaces with literal booleans, letting `if (DEV)` blocks be eliminated.
export function registerEsmEnvStrip(build: PluginBuilder): void {
  build.onLoad({ filter: /node_modules\/svelte\/src\/.*\.js$/ }, async (args) => ({
    contents: (await Bun.file(args.path).text()).replace(/import\s*\{[^}]*\}\s*from\s*['"]esm-env['"]\s*;?/g, ''),
    loader: 'js',
  }));
}

export function registerMochiEnvClient(build: PluginBuilder, development: boolean): void {
  const cookiesClientPath = toPosixPath(path.join(SRC_DIR, 'runtime/cookies.client.ts'));
  const enhanceClientPath = toPosixPath(path.join(SRC_DIR, 'runtime/enhance.client.ts'));
  build.onResolve({ filter: /^mochi-framework$/ }, () => ({
    path: 'mochi-framework',
    namespace: 'mochi-env',
  }));
  build.onLoad({ filter: /.*/, namespace: 'mochi-env' }, () => ({
    contents: renderMochiEnvClient(development, cookiesClientPath, enhanceClientPath),
    loader: 'js',
  }));
}

export function registerSvelteModuleLoader(build: PluginBuilder, backend: SvelteCompilerBackend, options: CompileOptions): void {
  build.onLoad({ filter: /\.svelte\.[jt]s$/ }, async (args) => {
    let source = await Bun.file(args.path).text();
    if (args.path.endsWith('.ts')) {
      const transpiler = new Bun.Transpiler({ loader: 'ts' });
      source = transpiler.transformSync(source);
    }
    const { js } = backend.compileModule(source, { ...options, filename: args.path });
    return { contents: js.code, loader: 'js' };
  });
}
