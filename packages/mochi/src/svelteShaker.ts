/**
 * Drives the build-tool-agnostic svelte-shaker engine from Bun.
 *
 * svelte-shaker only ships Vite/Rollup plugins, but those are thin Shells over
 * an env-free engine (`svelteShaker` / `svelteShakerWithMono`). We supply the
 * Node Shell glue (`svelte-shaker/node`) ourselves instead of hosting a plugin.
 *
 * The engine is dynamically imported so it is loaded only when shaking actually
 * runs (production builds), keeping it out of every bundle graph.
 */

export interface ShakeOptions {
  /** L2 monomorphization. When omitted/false, only L0/L1/L1.5 run. */
  mono?: { maxVariants?: number; minSavings?: number };
}

export interface ShakeAppResult {
  /** Slimmed source per real `.svelte` file (owners rewritten when L2 specialized them). */
  sources: Map<string, string>;
  /** Generated L2 variant modules, keyed by their virtual sibling path. Empty without L2. */
  variants: Map<string, string>;
  /** Which owner each specialized call site belongs to, and the variant it now imports. */
  bindings: { owner: string; childId: string; variantId: string; variantPath: string }[];
}

/**
 * Map an L2 variant id (`<childId>::v<n>`) to an absolute sibling path of its
 * child (`…/Child.shaker_v<n>.svelte`). The file is never written to disk — the
 * host serves it from memory — but it must resolve *as if* it sat next to the
 * child, so the residual's relative imports (`./Icon.svelte`) stay valid.
 */
export function variantSpecifier(variantId: string): string {
  const sep = variantId.lastIndexOf('::v');
  const childPath = variantId.slice(0, sep);
  const n = variantId.slice(sep + 3);
  return childPath.replace(/\.svelte$/, `.shaker_v${n}.svelte`);
}

export async function shakeApp(appRoot: string, options: ShakeOptions = {}): Promise<ShakeAppResult> {
  const { collectSvelteFiles, fsResolve, fsReadFile } = await import('svelte-shaker/node');
  const entries = collectSvelteFiles(appRoot);
  if (entries.length === 0) {
    return { sources: new Map(), variants: new Map(), bindings: [] };
  }

  if (!options.mono) {
    const { svelteShaker } = await import('svelte-shaker');
    const shaken = await svelteShaker(entries, fsResolve, fsReadFile);
    return { sources: new Map(Object.entries(shaken)), variants: new Map(), bindings: [] };
  }

  const { svelteShakerWithMono } = await import('svelte-shaker');
  const { files, mono } = await svelteShakerWithMono(
    entries,
    fsResolve,
    fsReadFile,
    { enabled: true, maxVariants: options.mono.maxVariants ?? 8, minSavings: options.mono.minSavings ?? 0 },
    variantSpecifier,
  );
  const variants = new Map<string, string>();
  for (const v of mono.variants.values()) {
    variants.set(variantSpecifier(v.id), v.code);
  }
  const bindings = mono.bindings.map((b) => ({
    owner: b.owner,
    childId: b.childId,
    variantId: b.variantId,
    variantPath: variantSpecifier(b.variantId),
  }));
  return { sources: new Map(Object.entries(files)), variants, bindings };
}
