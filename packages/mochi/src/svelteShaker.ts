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

/** Local binding names introduced by an import statement, or `null` for a side-effect import. */
function parseImportBindings(stmt: string): string[] | null {
  const fromMatch = /^import\b([\s\S]*?)\bfrom\b/.exec(stmt);
  if (!fromMatch) {
    return null; // `import './x.css'` — side-effect only, never strip
  }
  const clause = (fromMatch[1] ?? '').trim().replace(/^type\s+/, ''); // `import type { … }`
  const names: string[] = [];
  // `* as ns`
  const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
  if (ns?.[1]) {
    names.push(ns[1]);
  }
  // default import: a leading identifier before any `{` or `*`
  const def = /^([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause);
  if (def?.[1]) {
    names.push(def[1]);
  }
  // named: `{ a, b as c, type D }`
  const braces = /\{([\s\S]*)\}/.exec(clause);
  if (braces?.[1]) {
    for (const raw of braces[1].split(',')) {
      const spec = raw.trim().replace(/^type\s+/, '');
      if (!spec) {
        continue;
      }
      const m = /(?:[A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)/.exec(spec);
      const local = m?.[1] ?? m?.[2];
      if (local) {
        names.push(local);
      }
    }
  }
  return names;
}

/**
 * Remove imports whose every binding is unreferenced in the rest of the file.
 *
 * svelte-shaker folds a `<Child/>` usage away (or an L2 owner stops using the
 * base child) but leaves the now-dead `import` for the bundler to tree-shake.
 * Rollup/Vite drop it; Bun does not tree-shake Svelte *client* modules (their
 * compiled form runs `template()` at module scope = side effects), so the
 * orphaned module — and everything it pulls in — would survive in the browser
 * bundle. We strip those imports ourselves.
 *
 * Conservative by construction: side-effect imports (`import './x.css'`) are
 * always kept, and an import is removed only when *none* of its local bindings
 * appear as a whole word anywhere outside the import statements. A binding used
 * in any form keeps its import.
 */
export function stripUnusedImports(source: string): string {
  const importRe = /import\b[^;'"]*?\bfrom\s*(['"])[^'"]+\1[ \t]*;?|import[ \t]*(['"])[^'"]+\2[ \t]*;?/g;
  const statements = source.match(importRe);
  if (!statements) {
    return source;
  }
  // Usage is judged against the source with every import statement blanked out,
  // so a binding's own import never counts as a reference to itself.
  let rest = source;
  for (const stmt of statements) {
    rest = rest.replace(stmt, ' ');
  }
  let out = source;
  for (const stmt of statements) {
    const bindings = parseImportBindings(stmt);
    if (!bindings || bindings.length === 0) {
      continue;
    }
    const used = bindings.some((name) => new RegExp(`\\b${name.replace(/[$]/g, '\\$&')}\\b`).test(rest));
    if (!used) {
      out = out.replace(stmt, '');
    }
  }
  return out;
}

export async function shakeApp(appRoot: string, options: ShakeOptions = {}): Promise<ShakeAppResult> {
  const { collectSvelteFiles, fsResolve, fsReadFile } = await import('svelte-shaker/node');
  const entries = collectSvelteFiles(appRoot);
  if (entries.length === 0) {
    return { sources: new Map(), variants: new Map(), bindings: [] };
  }

  const toMap = (record: Record<string, string>): Map<string, string> => {
    const m = new Map<string, string>();
    for (const [id, src] of Object.entries(record)) {
      m.set(id, stripUnusedImports(src));
    }
    return m;
  };

  if (!options.mono) {
    const { svelteShaker } = await import('svelte-shaker');
    const shaken = await svelteShaker(entries, fsResolve, fsReadFile);
    return { sources: toMap(shaken), variants: new Map(), bindings: [] };
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
    variants.set(variantSpecifier(v.id), stripUnusedImports(v.code));
  }
  const bindings = mono.bindings.map((b) => ({
    owner: b.owner,
    childId: b.childId,
    variantId: b.variantId,
    variantPath: variantSpecifier(b.variantId),
  }));
  return { sources: toMap(files), variants, bindings };
}
