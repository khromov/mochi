/**
 * Strips SSR-only components (`*.server.svelte`) out of the browser bundle. A `.server.svelte` renders on the server
 * like any component, but reaching it from an island's client graph — directly or through a barrel re-export — would
 * otherwise compile its whole body (and its `node:fs`/`bun:*` deps) into the chunk. Here the client build swaps each
 * one for a throwing-Proxy default-export stub. The suffix is the whole opt-in, so a plain filter is correct; no
 * allowlist is needed, unlike `serverOnlyModuleGuard`.
 *
 * Correctness comes from *replacing* the heavy module, not from tree-shaking the stub: even if Bun keeps the unused
 * stub, the real component's payload is already gone. The PURE-annotated Proxy in `buildServerOnlyStubModule` lets Bun
 * drop the leftover too.
 */
import type { PluginBuilder } from 'bun';
import path from 'node:path';
import { buildServerOnlyStubModule } from './serverOnlyScan';

export const SSR_ONLY_COMPONENT_NAMESPACE = 'mochi-ssr-only-component';

export function registerServerOnlyComponentStubs(build: PluginBuilder): void {
  build.onResolve({ filter: /\.server\.svelte$/ }, (args) => {
    const abs = args.resolveDir ? path.resolve(args.resolveDir, args.path) : path.resolve(args.path);
    // Stamp a dedicated namespace so the default `.svelte` file-namespace onLoad can't reclaim it.
    return { path: abs, namespace: SSR_ONLY_COMPONENT_NAMESPACE };
  });
  build.onLoad({ filter: /.*/, namespace: SSR_ONLY_COMPONENT_NAMESPACE }, (args) => ({
    contents: buildServerOnlyStubModule(args.path, { named: [], hasDefault: true, warnings: [] }),
    loader: 'js',
  }));
}
