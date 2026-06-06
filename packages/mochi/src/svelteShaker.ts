/**
 * Drives the build-tool-agnostic svelte-shaker engine from Bun.
 *
 * svelte-shaker only ships Vite/Rollup plugins, but those are thin Shells over
 * an env-free engine (`svelteShaker(entries, resolve, readFile)`). We supply the
 * Node Shell glue (`svelte-shaker/node`) ourselves instead of hosting a plugin.
 *
 * The engine is dynamically imported so it is loaded only when shaking actually
 * runs (production builds), keeping it out of every bundle graph.
 */
export async function shakeApp(appRoot: string): Promise<Map<string, string>> {
  const { svelteShaker } = await import('svelte-shaker');
  const { collectSvelteFiles, fsResolve, fsReadFile } = await import('svelte-shaker/node');
  const entries = collectSvelteFiles(appRoot);
  if (entries.length === 0) {
    return new Map();
  }
  const shaken = await svelteShaker(entries, fsResolve, fsReadFile);
  return new Map(Object.entries(shaken));
}
