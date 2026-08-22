/**
 * Turns raw `Bun.build` metafile input paths into the rows the debug bar's JS Bundles panel shows. The panel keys its
 * list on the cleaned string, so the transform must be injective: two distinct build inputs collapsing to one label
 * both hides a real duplicate-dependency signal and crashes the keyed `{#each}` with `each_key_duplicate`.
 */
import { SSR_ONLY_COMPONENT_NAMESPACE } from './serverOnlyComponents';
import { toPosixPath } from '../utils/index';

/** Virtual namespace holding `.server.ts` / `.server.js` modules stripped out of the client graph. */
export const SERVER_ONLY_MODULE_NAMESPACE = 'mochi-server-only';

// Bun's isolated linker (the default) installs into a `node_modules/.bun/<pkg>@<version>/node_modules/<pkg>/` store, so
// the version segment is the only thing telling two installed copies apart — keep it as the displayed prefix.
const STORE_PATH = /^(?:\.\.\/)*node_modules\/\.bun\/([^/]+)\/node_modules\/(?:@[^/]+\/)?[^/]+\/(.+)$/;
const LEADING_NODE_MODULES = /^(?:\.\.\/)*node_modules\//;

export function cleanInputPath(p: string): string {
  const posix = toPosixPath(p);

  const stub = posix.match(/^(mochi-ssr-only-component|mochi-server-only):(.*)$/);
  if (stub) {
    const kind = stub[1] === SSR_ONLY_COMPONENT_NAMESPACE ? 'SSR-only component stub' : 'server-only stub';
    return `${stub[2]} (${kind})`;
  }

  const store = posix.match(STORE_PATH);
  if (store) {
    return `${store[1]}/${store[2]}`;
  }
  return posix.replace(LEADING_NODE_MODULES, '');
}

export function cleanInputs(inputs: { path: string; size: number }[]): { path: string; size: number }[] {
  // A fully tree-shaken `.server.svelte` stub ships nothing, so its row would only confuse the panel — but a stub
  // with retained bytes means an island actually renders the component (it will throw at hydration), which is
  // exactly what the panel should surface, so those rows stay.
  return inputs.filter((i) => i.size > 0 || !i.path.startsWith(`${SSR_ONLY_COMPONENT_NAMESPACE}:`)).map((i) => ({ path: cleanInputPath(i.path), size: i.size }));
}
