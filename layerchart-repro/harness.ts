// Minimal "what Mochi does internally", using only Bun + Svelte:
//   1. compile .svelte / .svelte.[jt]s with svelte/compiler (server target)
//   2. bundle with Bun.build()
//   3. server-render with svelte/server's render()
//
// No framework involved — this is the smallest harness that can SSR a Svelte component
// (and a component tree that imports LayerChart).
import { compile, compileModule } from 'svelte/compiler';
import { render } from 'svelte/server';
import type { BunPlugin } from 'bun';
import { pathToFileURL } from 'node:url';

/** A Bun.build plugin that compiles Svelte components and rune modules for the server. */
export const svelteServerPlugin = (): BunPlugin => ({
  name: 'svelte-server',
  setup(build) {
    // Rune modules (.svelte.js / .svelte.ts) must go through compileModule, otherwise `$state`
    // and friends are undefined at runtime. LayerChart ships several (e.g. states/chart.svelte.js).
    build.onLoad({ filter: /\.svelte\.[jt]s$/ }, async ({ path }) => ({
      contents: compileModule(await Bun.file(path).text(), { generate: 'server', filename: path }).js.code,
      loader: 'js',
    }));
    build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
      contents: compile(await Bun.file(path).text(), { generate: 'server', filename: path }).js.code,
      loader: 'js',
    }));
  },
});

/** Build a Svelte entry for the server and return the output file path. */
export async function buildServer(entry: string, outdir: string): Promise<string> {
  const res = await Bun.build({
    entrypoints: [entry],
    target: 'bun',
    format: 'esm',
    // Keep svelte external so the built module shares the same runtime as render() below.
    external: ['svelte', 'svelte/*'],
    // LayerChart + @layerstack only expose a `svelte` export condition.
    conditions: ['svelte'],
    plugins: [svelteServerPlugin()],
    outdir,
    throw: false,
  });
  if (!res.success) throw new Error('build failed:\n' + res.logs.map(String).join('\n'));
  return res.outputs[0].path;
}

/**
 * Server-render a built component to an HTML string.
 *
 * NOTE: svelte/server's render() is lazy — the recursion happens when `.body` is *materialised*,
 * so you MUST consume `.body` to actually trigger the render (a bare render() call renders nothing).
 */
export async function renderToString(builtPath: string, cacheBust: string): Promise<string> {
  const mod = await import(pathToFileURL(builtPath).href + `?v=${cacheBust}`);
  const result = render(mod.default, { props: {} });
  return result.body;
}
