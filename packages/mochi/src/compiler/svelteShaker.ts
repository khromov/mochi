/**
 * Drives the build-tool-agnostic svelte-shaker engine from Bun. svelte-shaker ships only Vite/Rollup plugins, but those
 * are thin Shells over an env-free engine (`svelteShaker(entries, resolve, readFile)`), so Mochi supplies the Node Shell
 * glue (`svelte-shaker/node`) itself. That subpath is internal and non-plugin on a pre-1.0 package, so it can move
 * between releases — the dependency is pinned to an exact version and every bump treated as potentially breaking.
 *
 * Pinned at 0.13.0: 0.14.0 through 0.15.0 throw `JSON.stringify cannot serialize BigInt` from `transform.js` on the
 * mochi-site component graph, which the fallback below swallows — the build succeeds while every component silently
 * stops being slimmed. Verify a bump with a real `bun run build:site` and check the "slimmed N of M" line; the shake
 * unit tests don't reproduce it. The engine is dynamically imported so only production builds load it.
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
