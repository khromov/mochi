/**
 * Standalone production-Svelte build for the dev debug bar. The bar is framework-internal UI, so unlike user islands it
 * compiles with `dev: false` + the `production` condition — roughly a third of the dev-mode output — at the cost of
 * carrying its own small prod Svelte runtime instead of sharing the dev runtime chunk. Built once per process
 * (framework sources don't change under a running user app), same lifecycle as `buildInlineWebComponent`.
 */
import path from 'node:path';
import type { BunPlugin } from 'bun';
import { CLIENT_BUILD_DEFINE, serverOnlyModuleGuard } from './serverOnlyModuleGuard';
import { renderMochiEnvClient } from './virtualModuleTemplate';
import { formatBuildMessages } from './ComponentRegistry';
import type { SvelteCompilerBackend } from './svelteCompilerBackend';
import { toPosixPath } from '../utils';

const SRC_DIR = path.resolve(import.meta.dir, '..');

export const ESM_ENV_STRIP_FILTER = /node_modules\/svelte\/src\/.*\.js$/;

// Bun can't propagate constants through esm-env's conditional exports, so stripping the imports turns DEV/BROWSER/NODE
// into free variables that Bun's `define` replaces with literal booleans, letting `if (DEV)` blocks be eliminated.
export function stripEsmEnvImports(source: string): string {
  return source.replace(/import\s*\{[^}]*\}\s*from\s*['"]esm-env['"]\s*;?/g, '');
}

export interface DebugBarBundle {
  fileName: string;
  contents: string;
}

export async function buildDebugBarBundle(opts: { development: boolean; backend: SvelteCompilerBackend }): Promise<DebugBarBundle> {
  const { development, backend } = opts;
  const cookiesClientPath = toPosixPath(path.join(SRC_DIR, 'runtime/cookies.client.ts'));
  const enhanceClientPath = toPosixPath(path.join(SRC_DIR, 'runtime/enhance.client.ts'));

  const debugBarPlugin: BunPlugin = {
    name: 'mochi-debug-bar',
    setup(build) {
      build.onLoad({ filter: ESM_ENV_STRIP_FILTER }, async (args) => ({
        contents: stripEsmEnvImports(await Bun.file(args.path).text()),
        loader: 'js',
      }));
      // Svelte compiles production-mode here, but mochi-level env stays truthful: if the bar ever imports
      // `mochi-framework`'s `isDev`, it must still read `true` under a dev server.
      build.onResolve({ filter: /^mochi-framework$/ }, () => ({
        path: 'mochi-framework',
        namespace: 'mochi-env',
      }));
      build.onLoad({ filter: /.*/, namespace: 'mochi-env' }, () => ({
        contents: renderMochiEnvClient(development, cookiesClientPath, enhanceClientPath),
        loader: 'js',
      }));
      build.onLoad({ filter: /\.svelte\.[jt]s$/ }, async (args) => {
        let source = await Bun.file(args.path).text();
        if (args.path.endsWith('.ts')) {
          const transpiler = new Bun.Transpiler({ loader: 'ts' });
          source = transpiler.transformSync(source);
        }
        const { js } = backend.compileModule(source, { generate: 'client', filename: args.path, dev: false });
        return { contents: js.code, loader: 'js' };
      });
      build.onLoad({ filter: /\.svelte$/ }, async (args) => {
        const source = await Bun.file(args.path).text();
        const { js } = backend.compile(source, { generate: 'client', filename: args.path, css: 'injected', dev: false });
        return { contents: js.code, loader: 'js' };
      });
    },
  };

  const result = await Bun.build({
    entrypoints: [path.join(SRC_DIR, 'debug-bar', 'debugbar-entry.ts')],
    // The guard goes first so its `onResolve` sees a server-only specifier before the debug-bar plugin's own handlers.
    plugins: [serverOnlyModuleGuard, debugBarPlugin],
    target: 'browser',
    conditions: ['svelte', 'production'],
    define: {
      DEV: 'false',
      BROWSER: 'true',
      NODE: 'false',
      ...CLIENT_BUILD_DEFINE,
    },
    minify: true,
    naming: '[name]-[hash].[ext]',
    throw: false,
  });

  if (!result.success) {
    throw new Error(`Debug bar client build failed:\n${formatBuildMessages(result.logs)}`);
  }
  const output = result.outputs[0]!;
  return { fileName: path.basename(output.path), contents: await output.text() };
}
