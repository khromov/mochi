/**
 * Standalone production-Svelte build for the dev debug bar. The bar is framework-internal UI, so unlike user islands it
 * compiles with `dev: false` + the `production` condition — roughly a third of the dev-mode output — at the cost of
 * carrying its own small prod Svelte runtime instead of sharing the dev runtime chunk. Built once per process
 * (framework sources don't change under a running user app), same lifecycle as `buildInlineWebComponent`.
 */
import path from 'node:path';
import type { BunPlugin } from 'bun';
import { CLIENT_BUILD_DEFINE, serverOnlyModuleGuard } from './serverOnlyModuleGuard';
import { registerServerOnlyComponentStubs } from './serverOnlyComponents';
import { registerEsmEnvStrip, registerMochiEnvClient, registerSvelteModuleLoader } from './clientBuildLoaders';
import { mergeCompilerOptions } from './svelteConfig';
import { formatBuildMessages } from './formatBuildMessages';
import type { SvelteCompilerBackend } from './svelteCompilerBackend';

const SRC_DIR = path.resolve(import.meta.dir, '..');

export interface DebugBarBundle {
  fileName: string;
  contents: string;
}

export async function buildDebugBarBundle(opts: { development: boolean; backend: SvelteCompilerBackend }): Promise<DebugBarBundle> {
  const { development, backend } = opts;

  const debugBarPlugin: BunPlugin = {
    name: 'mochi-debug-bar',
    setup(build) {
      registerEsmEnvStrip(build);
      // Same server-only contract as the island client build: a `.server.svelte` reached from a future debug-bar
      // entry must stub, not compile its server body into the inline script.
      registerServerOnlyComponentStubs(build);
      // Svelte compiles production-mode here, but mochi-level env stays truthful: if the bar ever imports
      // `mochi-framework`'s `isDev`, it must still read `true` under a dev server.
      registerMochiEnvClient(build, development);
      // `mergeCompilerOptions` with no user options: framework defaults apply, user svelte config doesn't.
      registerSvelteModuleLoader(build, backend, mergeCompilerOptions(undefined, { generate: 'client', dev: false }));
      build.onLoad({ filter: /\.svelte$/ }, async (args) => {
        const source = await Bun.file(args.path).text();
        const { js } = backend.compile(source, mergeCompilerOptions(undefined, { generate: 'client', filename: args.path, css: 'injected', dev: false }));
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
  // No `.css`-strip or image-asset loader is registered here — a debug-bar component gaining such an import would add
  // outputs, so pick the entry by kind rather than trusting index 0.
  const entry = result.outputs.find((o) => o.kind === 'entry-point');
  if (!entry) {
    throw new Error('Debug bar client build produced no entry-point output');
  }
  return { fileName: path.basename(entry.path), contents: await entry.text() };
}
