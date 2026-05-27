import { checkEnvironment } from './checkEnvironment';
import { ComponentRegistry, formatCompileErrors } from './ComponentRegistry';
import { isMochiPage, isMochiApi, isMochiWs, isMochiSse } from './types';
import type { MarkdownConfig, MochiRouteValue } from './types';
import { rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { scanPublicDir } from './publicDir';
import { loadSvelteConfig } from './svelteConfig';
import { loadMarkdownConfig } from './loadMarkdownConfig';
import { logger, setLogLevel } from './log';
import { consoleLogger } from './consoleLogger';
import { mochiEvents } from './events';
import { styleText } from 'node:util';
import prettyBytes from './lib/prettyBytes';

export interface MochiBuildOptions {
  routes: Record<string, MochiRouteValue>;
  development?: boolean;
  /** Directory for build output (cwd-relative). Default: `./.mochi`. */
  outDir?: string;
  /** Static assets directory (cwd-relative). Default: `./public`. */
  publicDir?: string;
  /**
   * URL prefix under which framework client assets and the server island
   * endpoint are served. Baked into the prebuilt manifest so the runtime
   * server uses the same value. Default: `/_mochi`.
   */
  assetPrefix?: string;
  /**
   * Path to a Svelte config file (cwd-relative or absolute). Default:
   * `./svelte.config.js`. The file's `compilerOptions` are merged into
   * Mochi's defaults; missing file → defaults only.
   */
  svelteConfigPath?: string;
  /**
   * Path to a module that default-exports a `MarkdownConfig` object.
   * Mirror the value passed to `Mochi.serve({ markdownConfigPath })`.
   */
  markdownConfigPath?: string;
  /** @deprecated Use `markdownConfigPath` instead. */
  markdown?: MarkdownConfig;
}

type RouteKind = 'page' | 'api' | 'ws' | 'sse';

interface RouteEntry {
  pattern: string;
  kind: RouteKind;
  componentPath?: string;
}

export async function build(options: MochiBuildOptions): Promise<void> {
  await checkEnvironment();
  setLogLevel('info');
  consoleLogger({ compile: false });
  printHeader();
  const version = await readMochiVersion();
  console.log(styleText('dim', `Mochi v${version}`));
  console.log('Starting build...\n');
  const startedAt = performance.now();
  const development = options.development ?? false;
  const outDir = options.outDir ?? './.mochi';
  const publicDir = options.publicDir ?? './public';

  // Clean previous build artifacts
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(path.join(outDir, 'svelte-compile'), { recursive: true });
  mkdirSync(path.join(outDir, 'svelte-client'), { recursive: true });
  mkdirSync(path.join(outDir, 'svelte-css'), { recursive: true });

  if (options.markdown && !options.markdownConfigPath) {
    throw new Error(
      "The inline `markdown` option has been removed. Create a config file (e.g. `mdsvex.config.ts`) that default-exports your MarkdownConfig and pass `markdownConfigPath: './mdsvex.config.ts'` instead.",
    );
  }
  const svelteConfig = await loadSvelteConfig(options.svelteConfigPath);
  const markdown = options.markdownConfigPath ? await loadMarkdownConfig(options.markdownConfigPath) : undefined;
  const registry = new ComponentRegistry({
    development,
    outDir,
    assetPrefix: options.assetPrefix,
    svelteConfig,
    svelteConfigPath: options.svelteConfigPath,
    markdown,
    markdownConfigPath: options.markdownConfigPath,
  });

  // Compile all Mochi.page() handlers in one Bun.build so transitive deps
  // (devalue, mochi-framework internals) emit as shared chunks alongside the
  // per-page `.server.js` files instead of being inlined into every page.
  const compiledPages: string[] = [];
  const ssrEntrypoints: string[] = [];
  const allRoutes: RouteEntry[] = [];

  const compileStats = new Map<string, { ssrSizeBytes: number; hydratableCount: number }>();
  mochiEvents.on('compile:complete', ({ path: p, ssrSizeBytes, hydratableCount }) => {
    compileStats.set(p, { ssrSizeBytes, hydratableCount });
  });

  for (const [pattern, handler] of Object.entries(options.routes)) {
    if (isMochiPage(handler)) {
      allRoutes.push({ pattern, kind: 'page', componentPath: handler.componentPath });
      ssrEntrypoints.push(handler.componentPath);
      compiledPages.push(pattern);
    } else if (isMochiApi(handler)) {
      allRoutes.push({ pattern, kind: 'api' });
    } else if (isMochiWs(handler)) {
      allRoutes.push({ pattern, kind: 'ws' });
    } else if (isMochiSse(handler)) {
      allRoutes.push({ pattern, kind: 'sse' });
    }
  }

  if (ssrEntrypoints.length > 0) {
    await registry.compileAll(ssrEntrypoints);
  }

  const compileErrors = registry.getErrors();
  if (compileErrors.length > 0) {
    throw new Error(`[mochi:build] ${formatCompileErrors(compileErrors)}`);
  }

  allRoutes.sort((a, b) => a.pattern.localeCompare(b.pattern, undefined, { numeric: true }));
  printRouteTree(allRoutes, compileStats);

  // Clean up intermediate .raw.css files
  const cssDir = path.join(outDir, 'svelte-css');
  const glob = new Bun.Glob('*.raw.css');
  for (const raw of glob.scanSync(cssDir)) {
    rmSync(path.join(cssDir, raw));
  }

  // Copy publicDir into <outDir>/public and record URL→disk map on the registry.
  // First ensure no public file collides with a user-declared route, so
  // deploying never silently drops assets.
  const publicSrc = await scanPublicDir(publicDir);
  const conflicts: string[] = [];
  for (const urlPath of publicSrc.keys()) {
    if (urlPath in options.routes) {
      conflicts.push(urlPath);
    }
  }
  if (conflicts.length > 0) {
    throw new Error(
      `[mochi:build] ${publicDir} files collide with registered routes:\n` +
        conflicts.map((u) => `  - ${u}`).join('\n') +
        `\nRemove the file from ${publicDir} or rename the route.`,
    );
  }

  const publicFiles = new Map<string, string>();
  for (const [urlPath, srcPath] of publicSrc) {
    const destPath = path.join(outDir, 'public', urlPath);
    await Bun.write(destPath, Bun.file(srcPath));
    publicFiles.set(urlPath, destPath);
  }
  registry.setPublicFiles(publicFiles);

  // Write manifest
  const manifestPath = path.join(outDir, 'manifest.json');
  const manifest = registry.toManifest();
  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));

  const clientFileCount = Object.keys(manifest.clientFiles).length;
  const publicFileCount = publicFiles.size;
  const elapsed = formatDuration(performance.now() - startedAt);
  logger.info(
    `build: done in ${elapsed}. ${compiledPages.length} page(s), ${clientFileCount} client file(s), ${publicFileCount} public file(s). Manifest written to ${manifestPath}`,
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

async function readMochiVersion(): Promise<string> {
  const pkgPath = path.join(import.meta.dir, '..', 'package.json');
  const pkg = (await Bun.file(pkgPath).json()) as { version: string };
  return pkg.version;
}

function printHeader(): void {
  const art = ['         ', '(_)      ', '  (_)    ', '    (_)  ', '      \\  '];
  const wordmark = [
    ' __  __            _     _ ',
    '|  \\/  | ___   ___| |__ (_)',
    "| |\\/| |/ _ \\ / __| '_ \\| |",
    '| |  | | (_) | (__| | | | |',
    '|_|  |_|\\___/ \\___|_| |_|_|',
  ];
  console.log('');
  for (let i = 0; i < wordmark.length; i++) {
    console.log(styleText('cyan', art[i]!) + styleText('bold', wordmark[i]!));
  }
  console.log('');
}

function pageSymbol(hyd: number | null): string {
  return hyd != null && hyd > 0 ? styleText('green', '●') : styleText('cyan', '○');
}

function kindSymbol(kind: Exclude<RouteKind, 'page'>): string {
  switch (kind) {
    case 'api':
      return styleText('magenta', 'λ');
    case 'ws':
      return styleText('blue', '⇄');
    case 'sse':
      return styleText('green', '→');
  }
}

function printRouteTree(routes: RouteEntry[], stats: Map<string, { ssrSizeBytes: number; hydratableCount: number }>): void {
  if (routes.length === 0) {
    return;
  }

  const rows = routes.map(({ pattern, kind, componentPath }) => {
    const s = componentPath ? stats.get(componentPath) : undefined;
    return { pattern, kind, hyd: s?.hydratableCount ?? null, ssr: s ? prettyBytes(s.ssrSizeBytes) : null };
  });

  const patternWidth = Math.max('Route'.length, ...rows.map((r) => r.pattern.length));
  const islandsWidth = 'islands'.length;
  const bundleWidth = Math.max('bundle'.length, ...rows.map((r) => r.ssr?.length ?? 0));

  // "  ┌ ● " = 6 chars — header indent matches
  console.log(styleText('dim', `      ${'Route'.padEnd(patternWidth + 2)}  ${'islands'.padStart(islandsWidth)}  ${'bundle'.padStart(bundleWidth)}`));

  const n = routes.length;
  for (let i = 0; i < n; i++) {
    const { pattern, kind, hyd, ssr } = rows[i]!;
    const char = styleText('dim', n === 1 ? '─' : i === 0 ? '┌' : i === n - 1 ? '└' : '├');
    const symbol = kind === 'page' ? pageSymbol(hyd) : kindSymbol(kind);
    const coloredPattern = pattern.padEnd(patternWidth + 2).replace(/:[^/\s]+/g, (s: string) => styleText('cyan', s));
    const isPage = kind === 'page';
    const hydStr = isPage && hyd != null ? styleText('green', String(hyd).padStart(islandsWidth)) : styleText('dim', '-'.padStart(islandsWidth));
    const ssrStr = isPage && ssr != null ? styleText('dim', ssr.padStart(bundleWidth)) : styleText('dim', '-'.padStart(bundleWidth));
    console.log(`  ${char} ${symbol} ${coloredPattern}  ${hydStr}  ${ssrStr}`);
  }

  const legendEntries: string[] = [];
  if (rows.some((r) => r.kind === 'page' && r.hyd != null && r.hyd > 0)) {
    legendEntries.push(`${styleText('green', '●')} page with islands`);
  }
  if (rows.some((r) => r.kind === 'page' && (r.hyd === null || r.hyd === 0))) {
    legendEntries.push(`${styleText('cyan', '○')} ssr-only page`);
  }
  if (rows.some((r) => r.kind === 'api')) {
    legendEntries.push(`${styleText('magenta', 'λ')} api`);
  }
  if (rows.some((r) => r.kind === 'ws')) {
    legendEntries.push(`${styleText('blue', '⇄')} websocket`);
  }
  if (rows.some((r) => r.kind === 'sse')) {
    legendEntries.push(`${styleText('green', '→')} sse`);
  }
  console.log(`\n  ${legendEntries.join(styleText('dim', '  ·  '))}`);
}
