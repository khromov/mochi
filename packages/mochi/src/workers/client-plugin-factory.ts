import { compile as svelteCompile, compileModule as svelteCompileModule, type CompileOptions } from 'svelte/compiler';
import path from 'node:path';
import fs from 'node:fs';
import type { BunPlugin } from 'bun';
import { mergeCompilerOptions } from '../svelteConfig';
import { buildServerOnlyStubModule, scanServerOnlyExports } from '../serverOnlyScan';
import { createMarkdownLoader, MARKDOWN_FILE_FILTER } from '../markdownLoader';
import { logger } from '../log';
import type { MarkdownConfig } from '../types';
import type { ClientPluginConfig } from '../runBuildInWorker';

async function applyUserPreprocessors(source: string, _filename: string, _target: 'server' | 'client', _development: boolean): Promise<string> {
  return source;
}

export function createClientPlugin(config: ClientPluginConfig): { plugin: BunPlugin } {
  const { development, userCompilerOptions: rawCompilerOpts, frameworkDir, debugBarDir, cookiesClientPath, enhanceClientPath, markdownConfigPath } = config;
  const userCompilerOptions = rawCompilerOpts as CompileOptions;

  let markdown: MarkdownConfig | undefined;
  let markdownReady: Promise<void> | undefined;
  if (markdownConfigPath) {
    markdownReady = import(markdownConfigPath).then((mod) => {
      markdown = mod.default as MarkdownConfig;
    });
  }

  const plugin: BunPlugin = {
    name: 'svelte-client',
    async setup(build) {
      if (markdownReady) {
        await markdownReady;
      }

      build.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
      build.onResolve({ filter: /\.server(?:\.[jt]s)?$/ }, (args) => {
        const base = args.resolveDir ? path.resolve(args.resolveDir, args.path) : path.resolve(args.path);
        let resolved = base;
        if (!/\.[jt]s$/.test(base)) {
          const tsPath = `${base}.ts`;
          const jsPath = `${base}.js`;
          if (fs.existsSync(tsPath)) {
            resolved = tsPath;
          } else if (fs.existsSync(jsPath)) {
            resolved = jsPath;
          } else {
            resolved = tsPath;
          }
        }
        return { path: resolved, namespace: 'mochi-server-only' };
      });
      build.onLoad({ filter: /.*/, namespace: 'mochi-server-only' }, async (args) => {
        const source = await Bun.file(args.path).text();
        const scan = scanServerOnlyExports(source);
        for (const w of scan.warnings) {
          logger.warn(`[mochi] ${path.relative(process.cwd(), args.path)}: ${w}`);
        }
        return { contents: buildServerOnlyStubModule(args.path, scan), loader: 'js' };
      });
      build.onResolve({ filter: /^mochi-framework$/ }, () => ({
        path: 'mochi-framework',
        namespace: 'mochi-env',
      }));
      build.onLoad({ filter: /.*/, namespace: 'mochi-env' }, () => ({
        contents: [
          `export const isServer = false; export const isBrowser = true; export const DEV = ${development}; export const isDev = ${development};`,
          `export function getRequestContext() { throw new Error("getRequestContext() is only available on the server"); }`,
          `import { createClientCookies as __cc } from "${cookiesClientPath}";`,
          `const __clientCookies = __cc();`,
          `export const cookies = new Proxy({}, {`,
          `  get(_, p) {`,
          `    const r = __clientCookies[p];`,
          `    return typeof r === "function" ? r.bind(__clientCookies) : r;`,
          `  },`,
          `});`,
          `const __mochiServerOnly = (n) => new Proxy({}, {`,
          `  get() { throw new Error(n + " is only available on the server"); },`,
          `});`,
          `export const params = __mochiServerOnly("params");`,
          `const __loc = () => new URL(window.location.href);`,
          `export const url = new Proxy({}, {`,
          `  get(_, p) {`,
          `    const v = __loc();`,
          `    const r = v[p];`,
          `    return typeof r === "function" ? r.bind(v) : r;`,
          `  },`,
          `  set() { return false; },`,
          `  has(_, p) { return p in __loc(); },`,
          `  ownKeys() { return Reflect.ownKeys(__loc()); },`,
          `  getOwnPropertyDescriptor(_, p) {`,
          `    const d = Object.getOwnPropertyDescriptor(__loc(), p);`,
          `    if (d) d.configurable = true;`,
          `    return d;`,
          `  },`,
          `});`,
          `export const locals = __mochiServerOnly("locals");`,
          `import { logger as __mochi_logger, setLogLevel, getLogLevel } from "${path.join(frameworkDir, 'log.ts')}";`,
          `export { setLogLevel, getLogLevel };`,
          `export const logger = __mochi_logger;`,
          `if (typeof window !== "undefined" && window.__mochi_log_level) setLogLevel(window.__mochi_log_level);`,
          `export function devWarn(msg) { if (typeof window !== "undefined" && window.__mochi_warn) window.__mochi_warn(msg); else __mochi_logger.warn(msg); }`,
          `export { stringify, parse } from "${Bun.resolveSync('devalue', frameworkDir)}";`,
          `export function emitIslandProps() { throw new Error("emitIslandProps() is only available on the server"); }`,
          `export const mochiEvents = {`,
          `  all: new Map(),`,
          `  on() {},`,
          `  off() {},`,
          `  setHandler() {},`,
          `  emit(type) {`,
          `    __mochi_logger.warn(`,
          `      "mochiEvents.emit(" + JSON.stringify(type) + ") was called in the browser. " +`,
          `      "mochiEvents is server-only; client-side emits are no-ops."`,
          `    );`,
          `  },`,
          `};`,
          `export class MochiCache { constructor() { throw new Error("MochiCache is only available on the server"); } }`,
          `export { enhance, deserialize } from "${enhanceClientPath}";`,
        ].join('\n'),
        loader: 'js',
      }));
      build.onLoad({ filter: /node_modules\/svelte\/src\/.*\.js$/ }, async (args) => {
        let source = await Bun.file(args.path).text();
        source = source.replace(/import\s*\{[^}]*\}\s*from\s*['"]esm-env['"]\s*;?/g, '');
        return { contents: source, loader: 'js' };
      });
      build.onLoad({ filter: /\.svelte\.[jt]s$/ }, async (args) => {
        let source = await Bun.file(args.path).text();
        if (args.path.endsWith('.ts')) {
          const transpiler = new Bun.Transpiler({ loader: 'ts' });
          source = transpiler.transformSync(source);
        }
        const { js } = svelteCompileModule(
          source,
          mergeCompilerOptions(userCompilerOptions, {
            generate: 'client',
            filename: args.path,
            dev: development,
          }),
        );
        return { contents: js.code, loader: 'js' };
      });
      build.onLoad({ filter: /\.svelte$/ }, async (args) => {
        const source = await Bun.file(args.path).text();
        const preprocessed = await applyUserPreprocessors(source, args.path, 'client', development);
        const { js } = svelteCompile(
          preprocessed,
          mergeCompilerOptions(userCompilerOptions, {
            generate: 'client',
            filename: args.path,
            css: args.path.startsWith(debugBarDir) ? 'injected' : undefined,
            dev: development,
          }),
        );
        return { contents: js.code, loader: 'js' };
      });
      if (markdown) {
        build.onLoad({ filter: MARKDOWN_FILE_FILTER }, createMarkdownLoader({ markdown, target: 'client', development, userCompilerOptions }));
      }
    },
  };

  return { plugin };
}
