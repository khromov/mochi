import { compile as svelteCompile, compileModule as svelteCompileModule, type CompileOptions } from 'svelte/compiler';
import path from 'node:path';
import type { BunPlugin } from 'bun';
import type { HydratableComponent, ServerIslandComponent } from '../svelteAstPreprocess';
import { cachedPreprocessHydratable, createPreprocessCacheStats } from '../preprocessCache';
import { mergeCompilerOptions } from '../svelteConfig';
import { createMarkdownLoader, MARKDOWN_FILE_FILTER } from '../markdownLoader';
import type { MarkdownConfig } from '../types';
import type { SsrPluginConfig, SsrSideEffects } from '../runBuildInWorker';

// In the worker, the extensions registry is empty — no user preprocessors.
async function applyUserPreprocessors(source: string, _filename: string, _target: 'server' | 'client', _development: boolean): Promise<string> {
  return source;
}

export function createSsrPlugin(config: SsrPluginConfig): { plugin: BunPlugin; getSideEffects: () => SsrSideEffects } {
  const { development, userCompilerOptions: rawCompilerOpts, frameworkDir } = config;
  const userCompilerOptions = rawCompilerOpts as CompileOptions;

  const cssMap = new Map<string, string>();
  const importedCssPaths = new Set<string>();
  const allHydratables: HydratableComponent[] = [];
  const allServerIslands: ServerIslandComponent[] = [];
  const preprocessCacheStats = createPreprocessCacheStats();
  const fileHydratables = new Map<string, HydratableComponent[]>();

  let markdown: MarkdownConfig | undefined;
  let markdownReady: Promise<void> | undefined;
  if (config.markdownConfigPath) {
    markdownReady = import(config.markdownConfigPath).then((mod) => {
      markdown = mod.default as MarkdownConfig;
    });
  }

  const plugin: BunPlugin = {
    name: 'svelte-ssr',
    async setup(build) {
      if (markdownReady) {
        await markdownReady;
      }

      build.onLoad({ filter: /\.css$/ }, (args) => {
        importedCssPaths.add(args.path);
        return { contents: '', loader: 'js' };
      });
      build.onResolve({ filter: /^mochi-framework$/ }, () => ({
        path: 'mochi-framework',
        namespace: 'mochi-env',
      }));
      build.onLoad({ filter: /.*/, namespace: 'mochi-env' }, () => ({
        contents: [
          `export const isServer = true; export const isBrowser = false; export const DEV = ${development}; export const isDev = ${development};`,
          `export function getRequestContext() {`,
          `  const ctx = globalThis.__mochi_request_context__?.getStore();`,
          `  if (!ctx) throw new Error("getRequestContext() called outside of a request.");`,
          `  return ctx;`,
          `}`,
          `function __mochiCtxProxy(key) {`,
          `  return new Proxy({}, {`,
          `    get(_, p) {`,
          `      const v = getRequestContext()[key];`,
          `      const r = v[p];`,
          `      return typeof r === "function" ? r.bind(v) : r;`,
          `    },`,
          `    has(_, p) { return p in getRequestContext()[key]; },`,
          `    ownKeys() { return Reflect.ownKeys(getRequestContext()[key]); },`,
          `    getOwnPropertyDescriptor(_, p) {`,
          `      const d = Object.getOwnPropertyDescriptor(getRequestContext()[key], p);`,
          `      if (d) d.configurable = true;`,
          `      return d;`,
          `    },`,
          `  });`,
          `}`,
          `export const cookies = __mochiCtxProxy("cookies");`,
          `export const params  = __mochiCtxProxy("params");`,
          `export const url     = __mochiCtxProxy("url");`,
          `export const locals  = __mochiCtxProxy("locals");`,
          `import { logger as __mochi_logger, setLogLevel, getLogLevel } from "${path.join(frameworkDir, 'log.ts')}";`,
          `export { setLogLevel, getLogLevel };`,
          `export const logger = __mochi_logger;`,
          `export function devWarn(msg) { __mochi_logger.warn(msg); }`,
          `export { stringify, parse } from "${Bun.resolveSync('devalue', frameworkDir)}";`,
          `export { emitIslandProps } from "${path.join(frameworkDir, 'islandPropsRegistry.ts')}";`,
          `import __mochi_mitt__ from "${Bun.resolveSync('mitt', frameworkDir)}";`,
          `if (!globalThis.__mochi_events__) globalThis.__mochi_events__ = __mochi_mitt__();`,
          `export const mochiEvents = globalThis.__mochi_events__;`,
          `export { MochiCache } from "${path.join(frameworkDir, 'cache.ts')}";`,
          `export { enhance, deserialize } from "${path.join(frameworkDir, 'enhance.ssr.ts')}";`,
        ].join('\n'),
        loader: 'js',
      }));
      build.onResolve({ filter: /^mochi-server-island-runtime$/ }, () => ({
        path: 'mochi-server-island-runtime',
        namespace: 'mochi-server-island',
      }));
      build.onLoad({ filter: /.*/, namespace: 'mochi-server-island' }, () => ({
        contents: [`import { signProps } from "${path.join(frameworkDir, 'serverIslandCrypto.ts')}";`, `export { signProps };`].join('\n'),
        loader: 'js',
      }));
      build.onLoad({ filter: /\.svelte\.[jt]s$/ }, async (args) => {
        let source = await Bun.file(args.path).text();
        if (args.path.endsWith('.ts')) {
          const transpiler = new Bun.Transpiler({ loader: 'ts' });
          source = transpiler.transformSync(source);
        }
        const { js } = svelteCompileModule(
          source,
          mergeCompilerOptions(userCompilerOptions, {
            generate: 'server',
            filename: args.path,
          }),
        );
        return { contents: js.code, loader: 'js' };
      });
      build.onLoad({ filter: /\.svelte$/ }, async (args) => {
        const raw = await Bun.file(args.path).text();
        const preprocessed = await applyUserPreprocessors(raw, args.path, 'server', development);
        const isVendored = args.path.includes(`${path.sep}node_modules${path.sep}`);
        const { transformed, hydratables, serverIslands } = isVendored
          ? { transformed: preprocessed, hydratables: [] as HydratableComponent[], serverIslands: [] as ServerIslandComponent[] }
          : cachedPreprocessHydratable(preprocessed, args.path, preprocessCacheStats);
        fileHydratables.set(args.path, hydratables);
        allHydratables.push(...hydratables);
        allServerIslands.push(...serverIslands);

        const { js, css } = svelteCompile(
          transformed,
          mergeCompilerOptions(userCompilerOptions, {
            generate: 'server',
            filename: args.path,
          }),
        );
        if (css?.code) {
          cssMap.set(args.path, css.code);
        }
        return { contents: js.code, loader: 'js' };
      });
      if (markdown) {
        build.onLoad(
          { filter: MARKDOWN_FILE_FILTER },
          createMarkdownLoader({
            markdown,
            target: 'server',
            development,
            cssMap,
            userCompilerOptions,
            hydration: { fileHydratables, allHydratables, allServerIslands, preprocessCacheStats },
          }),
        );
      }
    },
  };

  function getSideEffects(): SsrSideEffects {
    return {
      cssMap: [...cssMap.entries()],
      importedCssPaths: [...importedCssPaths],
      fileHydratables: [...fileHydratables.entries()].map(([k, v]) => [k, v.map((h) => ({ name: h.name, resolvedPath: h.resolvedPath }))]),
      allHydratables: allHydratables.map((h) => ({ name: h.name, resolvedPath: h.resolvedPath })),
      allServerIslands: allServerIslands.map((h) => ({ name: h.name, resolvedPath: h.resolvedPath })),
      preprocessCacheStats: { hits: preprocessCacheStats.hits, misses: preprocessCacheStats.misses },
    };
  }

  return { plugin, getSideEffects };
}
