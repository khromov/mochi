/**
 * Drives the build-tool-agnostic svelte-shaker engine from Bun.
 *
 * svelte-shaker only ships Vite/Rollup plugins, but those are thin Shells over
 * an env-free engine (`svelteShaker(entries, resolve, readFile)`). We supply the
 * Node Shell glue (`svelte-shaker/node`) ourselves instead of hosting a plugin.
 *
 * Because `svelte-shaker/node` is an internal, non-plugin subpath of a pre-1.0
 * package, it can move between patch releases — so the dependency is pinned to an
 * exact version (see `package.json`) rather than a caret range.
 *
 * The engine is dynamically imported so it is loaded only when shaking actually
 * runs (production builds), keeping it out of every bundle graph.
 */
export interface ShakeAppResult {
  /** absPath → slimmed `.svelte` source for every in-scope component. */
  shaken: Map<string, string>;
  /** absPath → original on-disk source, captured during the shake's own reads */
  originals: Map<string, string>;
}

export async function shakeApp(appRoot: string): Promise<ShakeAppResult> {
  const { svelteShaker } = await import('svelte-shaker');
  const { collectSvelteFiles, fsResolve, fsReadFile } = await import('svelte-shaker/node');
  const entries = collectSvelteFiles(appRoot);
  if (entries.length === 0) {
    return { shaken: new Map(), originals: new Map() };
  }
  // Capture the engine's own reads so callers can diff original→shaken without a
  // second disk pass. `readFile` may return sync or a Promise — record either.
  const originals = new Map<string, string>();
  const recordingReadFile = (id: string): Promise<string> | string => {
    const content = fsReadFile(id);
    if (typeof content === 'string') {
      originals.set(id, content);
      return content;
    }
    return content.then((text) => {
      originals.set(id, text);
      return text;
    });
  };
  const shaken = await svelteShaker(entries, fsResolve, recordingReadFile);
  return { shaken: new Map(Object.entries(shaken)), originals };
}
