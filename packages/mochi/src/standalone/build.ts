import path from 'node:path';
import fs from 'node:fs';
import type { BunPlugin } from 'bun';
import type { MochiPageConfig } from '../types';
import { CLIENT_BUILD_DEFINE, serverOnlyModuleGuard } from '../compiler/serverOnlyModuleGuard';
import { registerServerOnlyComponentStubs } from '../compiler/serverOnlyComponents';
import { registerEsmEnvStrip, registerMochiEnvClient, registerSvelteModuleLoader } from '../compiler/clientBuildLoaders';
import { mergeCompilerOptions } from '../compiler/svelteConfig';
import type { SvelteCompilerBackend } from '../compiler/svelteCompilerBackend';
import { formatBuildMessages } from '../compiler/formatBuildMessages';
import { applyUserPreprocessors } from '../compiler/userPreprocess';
import { stripMochiDirectives } from '../compiler/stripMochiDirectives';
import { SERVER_ONLY_MODULE_NAMESPACE } from '../compiler/bundleInputPaths';
import { scanServerOnlyExports, buildServerOnlyStubModule } from '../compiler/serverOnlyScan';
import { logger } from '../utils/log';
import { relForDisplay, resolveArgsPath, toPosixPath } from '../utils';
import type { CompileOptions } from 'svelte/compiler';

const SRC_DIR = path.join(path.dirname(Bun.fileURLToPath(import.meta.url)), '..');

export interface StandaloneClientBuild {
  entryFileName: string;
  cssFileNames: string[];
  /** Output basename → absolute path on disk (JS chunks and CSS bundles alike). */
  files: Map<string, string>;
}

/**
 * The standalone client `Bun.build`: bundles the user's app entry (whose `Mochi.standalone()` call resolves to the
 * in-browser bootstrap via the virtual `mochi-framework` module) behind a generated prologue that registers every
 * route component by its authored path string. Modeled on `buildDebugBarBundle`; artifacts land in `outDir` with
 * relative chunk imports, so the emitted app is servable from any origin — including Capacitor's.
 */
export async function buildStandaloneClient(opts: {
  /** Absolute path of the user's app entry (the file calling `Mochi.standalone()`). */
  entryPath: string;
  routes: Record<string, MochiPageConfig>;
  notFound?: MochiPageConfig;
  loading?: MochiPageConfig;
  development: boolean;
  /** Absolute destination directory for the JS/CSS artifacts. */
  outDir: string;
  backend: SvelteCompilerBackend;
  userCompilerOptions: CompileOptions;
}): Promise<StandaloneClientBuild> {
  const { development, backend, userCompilerOptions } = opts;

  const clientRegistryPath = toPosixPath(path.join(SRC_DIR, 'standalone', 'clientRegistry.ts'));
  const pages = [...Object.values(opts.routes), ...(opts.notFound ? [opts.notFound] : []), ...(opts.loading ? [opts.loading] : [])];
  const componentPaths = new Map<string, string>();
  for (const page of pages) {
    if (componentPaths.has(page.componentPath)) {
      continue;
    }
    const resolved = path.resolve(page.componentPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Standalone route component not found: ${page.componentPath} (resolved to ${toPosixPath(resolved)})`);
    }
    componentPaths.set(page.componentPath, resolved);
  }

  // ESM evaluates a module's imports before its own body, so anything that must run before app.ts's top-level
  // `Mochi.standalone()` call has to live in the body of an EARLIER-imported module, not in the entry's body:
  // the process shim (app entries read `process.env.*`, which doesn't exist in a browser) and the component
  // registrations (the router resolves the descriptors' path strings through the registry).
  const processShimPath = toPosixPath(path.join(SRC_DIR, 'standalone-process-shim.js'));
  const registerModulePath = toPosixPath(path.join(SRC_DIR, 'standalone-register.js'));
  let registerSource = `import { registerRouteComponent } from "${clientRegistryPath}";\n`;
  let componentIndex = 0;
  for (const [componentPath, resolved] of componentPaths) {
    const local = `__mochi_route_component_${componentIndex++}`;
    registerSource += `import ${local} from "${toPosixPath(resolved)}";\nregisterRouteComponent(${JSON.stringify(componentPath)}, ${local});\n`;
  }
  const entrySource = `import "${processShimPath}";\nimport "${registerModulePath}";\nimport "${toPosixPath(opts.entryPath)}";\n`;

  const virtualEntryPath = toPosixPath(path.join(SRC_DIR, 'standalone-app.js'));

  const standalonePlugin: BunPlugin = {
    name: 'mochi-standalone-client',
    setup(build) {
      // Same server-only contract as the island client build: `.server.*` modules become throwing stubs so the real
      // file and its `bun:*` deps stay out of the browser graph.
      build.onResolve({ filter: /\.server(?:\.[jt]s)?$/ }, (args) => {
        const base = resolveArgsPath(args);
        let resolved = base;
        if (!/\.[jt]s$/.test(base)) {
          const tsPath = `${base}.ts`;
          const jsPath = `${base}.js`;
          resolved = fs.existsSync(tsPath) ? tsPath : fs.existsSync(jsPath) ? jsPath : tsPath;
        }
        return { path: resolved, namespace: SERVER_ONLY_MODULE_NAMESPACE };
      });
      build.onLoad({ filter: /.*/, namespace: SERVER_ONLY_MODULE_NAMESPACE }, async (args) => {
        const source = await Bun.file(args.path).text();
        const scan = scanServerOnlyExports(source);
        for (const w of scan.warnings) {
          logger.warn(`[mochi] ${relForDisplay(args.path)}: ${w}`);
        }
        return { contents: buildServerOnlyStubModule(relForDisplay(args.path), scan), loader: 'js' };
      });
      registerServerOnlyComponentStubs(build);
      registerMochiEnvClient(build, development, true);
      // Insurance against a stray boundary specifier, mirroring the island client build.
      build.onResolve({ filter: /^mochi-framework\/hydratable-boundary$/ }, () => ({
        path: path.join(SRC_DIR, 'islands/HydratableBoundary.svelte'),
      }));
      registerEsmEnvStrip(build);
      registerSvelteModuleLoader(build, backend, mergeCompilerOptions(userCompilerOptions, { generate: 'client', dev: development }));
      build.onLoad({ filter: /\.svelte$/ }, async (args) => {
        const source = await Bun.file(args.path).text();
        const preprocessed = await applyUserPreprocessors(source, args.path, 'client', development);
        // There is no SSR pass to rewrite `mochi:*` directives into island wrappers, and everything mounts client-side
        // anyway — so shared components get their directives stripped before the compile.
        const stripped = stripMochiDirectives(preprocessed);
        const { js } = backend.compile(
          stripped,
          mergeCompilerOptions(userCompilerOptions, {
            generate: 'client',
            filename: args.path,
            // Forced layer: scoped CSS ships inside the JS (nothing paints before the app mounts), which keeps the
            // whole per-component CSS registry out of the standalone pipeline.
            css: 'injected',
            dev: development,
          }),
        );
        return { contents: js.code, loader: 'js' };
      });
    },
  };

  const result = await Bun.build({
    entrypoints: [virtualEntryPath],
    files: {
      [virtualEntryPath]: entrySource,
      [processShimPath]: 'globalThis.process ??= { env: {} };\n',
      [registerModulePath]: registerSource,
    },
    // The guard goes first so its `onResolve` sees a server-only specifier before the standalone plugin's own handlers.
    plugins: [serverOnlyModuleGuard, standalonePlugin],
    target: 'browser',
    conditions: ['svelte', development ? 'development' : 'production'],
    define: {
      DEV: String(development),
      BROWSER: 'true',
      NODE: 'false',
      ...CLIENT_BUILD_DEFINE,
    },
    minify: !development,
    splitting: true,
    // No `publicPath`: chunk imports come out relative (`./chunk-*.js`), which is what a Capacitor webview origin needs.
    naming: '[name]-[hash].[ext]',
    outdir: opts.outDir,
    throw: false,
  });

  if (!result.success) {
    throw new Error(`Standalone client build failed:\n${formatBuildMessages(result.logs)}`);
  }

  let entryFileName: string | null = null;
  const cssFileNames: string[] = [];
  const files = new Map<string, string>();
  for (const output of result.outputs) {
    const fileName = path.basename(output.path);
    files.set(fileName, output.path);
    if (output.kind === 'entry-point') {
      entryFileName = fileName;
    } else if (fileName.endsWith('.css')) {
      cssFileNames.push(fileName);
    }
  }
  if (!entryFileName) {
    throw new Error('Standalone client build produced no entry-point output');
  }
  return { entryFileName, cssFileNames, files };
}
