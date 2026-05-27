import { compile as svelteCompile, compileModule as svelteCompileModule } from 'svelte/compiler';
import type { BunPlugin } from 'bun';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSvelteConfig, mergeCompilerOptions } from './svelteConfig';
import { loadMarkdownConfig } from './loadMarkdownConfig';
import { buildServerOnlyStubModule, scanServerOnlyExports } from './serverOnlyScan';
import { applyUserPreprocessors, createMarkdownLoader, formatBuildMessages, MARKDOWN_FILE_FILTER } from './svelteCompileHelpers';

const FRAMEWORK_DIR = path.dirname(fileURLToPath(import.meta.url));

interface ClientBuildConfig {
  entrypoints: string[];
  files: Record<string, string>;
  outdir: string;
  publicPath: string;
  development: boolean;
  debugBarEnabled: boolean;
  conditions: string[];
  define: Record<string, string>;
  svelteConfigPath?: string;
  markdownConfigPath?: string;
}

interface ClientBuildResultSuccess {
  success: true;
  metafile: Record<string, unknown>;
  outputs: Array<{ path: string; basename: string }>;
}

interface ClientBuildResultFailure {
  success: false;
  error: string;
}

type ClientBuildResult = ClientBuildResultSuccess | ClientBuildResultFailure;

async function main(): Promise<void> {
  const configPath = process.argv[2];
  const resultPath = process.argv[3];
  if (!configPath || !resultPath) {
    process.stderr.write('Usage: bun buildClientWorker.ts <config.json> <result.json>\n');
    process.exit(1);
  }

  const config: ClientBuildConfig = await Bun.file(configPath).json();
  const { development } = config;

  const svelteConfig = await loadSvelteConfig(config.svelteConfigPath);
  const userCompilerOptions = svelteConfig.compilerOptions ?? {};
  const markdown = config.markdownConfigPath ? await loadMarkdownConfig(config.markdownConfigPath) : undefined;

  const debugBarDir = path.join(FRAMEWORK_DIR, 'debug-bar') + path.sep;
  const cookiesClientPath = path.join(FRAMEWORK_DIR, 'cookies.client.ts');
  const enhanceClientPath = path.join(FRAMEWORK_DIR, 'enhance.client.ts');

  const clientPlugin: BunPlugin = {
    name: 'svelte-client',
    setup(build) {
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
          process.stderr.write(`[mochi] ${path.relative(process.cwd(), args.path)}: ${w}\n`);
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
          `import { logger as __mochi_logger, setLogLevel, getLogLevel } from "${path.join(FRAMEWORK_DIR, 'log.ts')}";`,
          `export { setLogLevel, getLogLevel };`,
          `export const logger = __mochi_logger;`,
          `if (typeof window !== "undefined" && window.__mochi_log_level) setLogLevel(window.__mochi_log_level);`,
          `export function devWarn(msg) { if (typeof window !== "undefined" && window.__mochi_warn) window.__mochi_warn(msg); else __mochi_logger.warn(msg); }`,
          `export { stringify, parse } from "${Bun.resolveSync('devalue', FRAMEWORK_DIR)}";`,
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

  const result = await Bun.build({
    entrypoints: config.entrypoints,
    files: config.files,
    plugins: [clientPlugin],
    target: 'browser',
    conditions: config.conditions,
    define: config.define,
    minify: true,
    splitting: true,
    naming: '[name]-[hash].[ext]',
    publicPath: config.publicPath,
    outdir: config.outdir,
    metafile: true,
    throw: false,
  });

  let buildResult: ClientBuildResult;
  if (!result.success) {
    buildResult = {
      success: false,
      error: formatBuildMessages(result.logs),
    };
  } else {
    buildResult = {
      success: true,
      metafile: (result.metafile ?? {}) as Record<string, unknown>,
      outputs: result.outputs.map((o) => ({ path: o.path, basename: path.basename(o.path) })),
    };
  }

  await Bun.write(resultPath, JSON.stringify(buildResult));
}

await main();
