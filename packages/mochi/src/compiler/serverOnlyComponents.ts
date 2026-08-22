/**
 * Strips SSR-only components (`*.server.svelte`) out of the browser bundle by swapping each one for a throwing-Proxy
 * stub in the client build; the suffix is the whole opt-in, so a plain filter is correct and no allowlist is needed,
 * unlike `serverOnlyModuleGuard`.
 */
import type { PluginBuilder } from 'bun';
import path from 'node:path';
import { parse } from 'svelte/compiler';
import { buildServerOnlyStubModule, scanServerOnlyExports, type ScanResult } from './serverOnlyScan';
import { relForDisplay, resolveArgsPath } from '../utils/index';

export const SSR_ONLY_COMPONENT_NAMESPACE = 'mochi-ssr-only-component';

// A `<script module>` block's named exports survive into the compiled component module, so the stub must mirror them
// or Bun fails the whole build on the missing name. A parse failure falls back to the default-only shape — the SSR
// build compiles the same file and surfaces the real syntax error.
function scanComponentExports(source: string): ScanResult {
  try {
    const moduleScript = parse(source, { modern: true }).module;
    if (moduleScript) {
      // Svelte's AST nodes carry start/end, but the estree Program type doesn't declare them.
      const content = moduleScript.content as unknown as { start: number; end: number };
      const scan = scanServerOnlyExports(source.slice(content.start, content.end));
      return { ...scan, hasDefault: true };
    }
  } catch {
    // fall through
  }
  return { named: [], hasDefault: true, warnings: [] };
}

export function registerServerOnlyComponentStubs(build: PluginBuilder): void {
  build.onResolve({ filter: /\.server\.svelte$/ }, (args) => {
    const relative = args.path.startsWith('./') || args.path.startsWith('../') || path.isAbsolute(args.path);
    let abs: string;
    if (relative) {
      abs = resolveArgsPath(args);
    } else {
      // Bare package specifiers go through real resolution so the stub names the actual file (one identity per module,
      // not one per importing directory); an unresolvable one falls through to Bun's own clear resolve error.
      try {
        abs = Bun.resolveSync(args.path, args.resolveDir || process.cwd());
      } catch {
        return undefined;
      }
    }
    // Stamp a dedicated namespace so the default `.svelte` file-namespace onLoad can't reclaim it.
    return { path: abs, namespace: SSR_ONLY_COMPONENT_NAMESPACE };
  });
  build.onLoad({ filter: /.*/, namespace: SSR_ONLY_COMPONENT_NAMESPACE }, async (args) => {
    const source = await Bun.file(args.path)
      .text()
      .catch(() => '');
    return {
      contents: buildServerOnlyStubModule(relForDisplay(args.path), scanComponentExports(source), { component: true }),
      loader: 'js',
    };
  });
}
