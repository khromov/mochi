import path from 'node:path';
import fs from 'node:fs';
import type { MochiStandaloneOptions } from '../types';
import { validateStandaloneOptions } from './validate';
import { buildStandaloneClient, type StandaloneClientBuild } from './build';
import { loadSvelteConfig } from '../compiler/svelteConfig';
import { resolveSvelteCompiler } from '../compiler/svelteCompilerBackend';
import { parseShellTemplate } from '../Mochi';
import { logger, setLogLevel, DEFAULT_LOG_LEVEL } from '../utils/log';
import { relForDisplay, toPosixPath } from '../utils';
import { scanPublicDir } from '../runtime/publicDir';

const DEFAULT_OUT_DIR = './dist';
const DEFAULT_PUBLIC_DIR = './public';

async function defaultShell(): Promise<string> {
  return Bun.file(new URL('../templates/default-standalone-shell.html', import.meta.url)).text();
}

export async function loadStandaloneShell(options: MochiStandaloneOptions): Promise<string> {
  if (options.htmlShell === undefined) {
    return defaultShell();
  }
  if (options.htmlShell.endsWith('.html')) {
    return Bun.file(path.resolve(options.htmlShell)).text();
  }
  return options.htmlShell;
}

/** Fill the shell template's `{{mochi.*}}` placeholders once — the standalone equivalent of the per-request shell renderer. */
export function renderStandaloneHtml(opts: { template: string; build: StandaloneClientBuild; logLevel?: string; liveReloadClientJs?: string }): string {
  const logLevelScript = opts.logLevel && opts.logLevel !== DEFAULT_LOG_LEVEL ? `<script>window.__mochi_log_level=${JSON.stringify(opts.logLevel)}</script>` : '';
  // Every asset reference is `./`-relative: Capacitor serves the app from its own webview origin where absolute paths break.
  const css = opts.build.cssFileNames.map((f) => `<link rel="stylesheet" href="./${f}">`).join('\n');
  const body = '<div id="mochi-app"></div>';
  const script =
    `<script type="module" src="./${opts.build.entryFileName}"></script>` +
    (opts.liveReloadClientJs ? `<script>${opts.liveReloadClientJs}</script><mochi-live-reload></mochi-live-reload>` : '');
  let out = '';
  for (const part of parseShellTemplate(opts.template)) {
    if ('text' in part) {
      out += part.text;
    } else {
      out += part.slot === 'head' ? logLevelScript : part.slot === 'css' ? css : part.slot === 'body' ? body : script;
    }
  }
  return out;
}

/**
 * The real `Mochi.standalone()`: in development it boots the static dev server with full-page live reload; otherwise
 * it writes the static app (index.html + JS/CSS + publicDir files) to `outDir` and returns.
 */
export async function runStandalone(options: MochiStandaloneOptions, overrides?: { entryPath?: string }): Promise<void> {
  validateStandaloneOptions(options);
  const development = options.development ?? true;
  if (options.logger?.level) {
    setLogLevel(options.logger.level);
  }
  // `Bun.main` is the app entry when the user runs it directly; the build CLI passes the entry explicitly.
  const entryPath = overrides?.entryPath ?? Bun.main;
  const svelteConfig = await loadSvelteConfig(options.svelteConfigPath);
  const backend = await resolveSvelteCompiler(undefined);
  const userCompilerOptions = svelteConfig.compilerOptions ?? {};

  if (development) {
    const { startStandaloneDevServer } = await import('./devServer');
    await startStandaloneDevServer({ options, entryPath, backend, userCompilerOptions });
    return;
  }

  const outDir = path.resolve(options.outDir ?? DEFAULT_OUT_DIR);
  // The build wipes outDir, so refuse a directory that contains the project itself.
  if (outDir === process.cwd() || process.cwd().startsWith(outDir + path.sep)) {
    throw new Error(`Standalone outDir (${toPosixPath(outDir)}) must be a subdirectory of the project, not the project root or a parent.`);
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const build = await buildStandaloneClient({
    entryPath,
    routes: options.routes,
    notFound: options.notFound,
    loading: options.loading,
    development: false,
    outDir,
    backend,
    userCompilerOptions,
  });

  const template = await loadStandaloneShell(options);
  const html = renderStandaloneHtml({ template, build, logLevel: options.logger?.level });
  await Bun.write(path.join(outDir, 'index.html'), html);

  const publicDir = path.resolve(options.publicDir ?? DEFAULT_PUBLIC_DIR);
  let publicCount = 0;
  if (fs.existsSync(publicDir)) {
    for (const [urlPath, diskPath] of await scanPublicDir(publicDir)) {
      const relative = urlPath.replace(/^\//, '');
      if (relative === 'index.html' || build.files.has(relative)) {
        logger.warn(`[mochi] Skipping public file "${relative}" — it collides with a standalone build output.`);
        continue;
      }
      const dest = path.join(outDir, relative);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await Bun.write(dest, Bun.file(diskPath));
      publicCount++;
    }
  }

  // A one-shot CLI-style operation reports via console.log, matching `mochi-framework build`'s report.
  const fileCount = build.files.size + 1 + publicCount;
  console.log(`Standalone app built: ${fileCount} files in ${relForDisplay(outDir)}/ (entry ./${build.entryFileName})`);
}
