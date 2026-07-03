import { checkEnvironment } from './checkEnvironment';
import { ComponentRegistry, formatCompileErrors } from './ComponentRegistry';
import { isMochiPage, isMochiApi, isMochiWs, isMochiSse } from './types';
import type { MarkdownConfig, MochiRouteValue, MochiSvelteShakerOptions } from './types';
import { rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { scanPublicDir, publicRouteKey } from './publicDir';
import { loadSvelteConfig } from './svelteConfig';
import { logger, setLogLevel } from './log';
import { consoleLogger } from './consoleLogger';
import { mochiEvents } from './events';
import { styleText } from 'node:util';
import prettyBytes from './vendor/pretty-bytes';

export interface MochiBuildOptions {
  routes: Record<string, MochiRouteValue>;
  development?: boolean;
  /**
   * Base directory for build output (cwd-relative). Default: `./.mochi`.
   * A `--dev` build nests under `<outDir>/dev`; production writes to the root.
   */
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
   * Dependency-injected markdown (`.md` / `.svx`) support. Mirror the value
   * passed to `Mochi.serve({ markdown })` so the prebuild and the runtime
   * use the same pipeline. Omit to leave markdown unhandled.
   */
  markdown?: MarkdownConfig;
  /**
   * Run the whole-program svelte-shaker pass before compiling. Mirror the value
   * passed to `Mochi.serve({ optimize })` so the prebuilt manifest and the
   * runtime agree. Default: `false`.
   */
  optimize?: boolean | MochiSvelteShakerOptions;
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
  const baseOutDir = options.outDir ?? './.mochi';
  // Mirror the dev/prod split in Mochi.serve(): a `--dev` build nests under
  // `dev/` so it can't clobber the production manifest at the root.
  const outDir = development ? path.join(baseOutDir, 'dev') : baseOutDir;
  const publicDir = options.publicDir ?? './public';

  // Clean previous build artifacts
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(path.join(outDir, 'svelte-compile'), { recursive: true });
  mkdirSync(path.join(outDir, 'svelte-client'), { recursive: true });
  mkdirSync(path.join(outDir, 'svelte-css'), { recursive: true });

  const svelteConfig = await loadSvelteConfig(options.svelteConfigPath);
  const registry = new ComponentRegistry({
    development,
    outDir,
    assetPrefix: options.assetPrefix,
    svelteConfig,
    markdown: options.markdown,
    optimize: options.optimize,
  });
  await registry.prepareShake();

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

  let compileErrors = registry.getErrors();
  if (compileErrors.length > 0) {
    throw new Error(`[mochi:build] ${formatCompileErrors(compileErrors)}`);
  }

  // Precompile server islands (mochi:defer) as standalone SSR modules so the
  // production runtime never compiles on a request path. Otherwise the first
  // fetch of each deferred island triggers an on-demand compile at runtime
  // (registry.compile in the server-island endpoint). Discovery is eager — a
  // `mochi:defer` island's import stays in its compiled source (only the
  // markup usage is rewritten), so compiling a page transitively resolves
  // every island it references. If eager discovery is ever defeated (e.g. a
  // `mochi:defer` target resolved through something other than a static
  // import), the island simply won't be in the manifest — the server-island
  // endpoint in Mochi.ts warns and falls back to an on-demand compile rather
  // than throwing here.
  const islandPaths = [...new Set(registry.getServerIslandPaths().values())];
  if (islandPaths.length > 0) {
    logger.info(`[mochi:build] precompiling ${islandPaths.length} server island(s): ${islandPaths.map((p) => path.basename(p)).join(', ')}`);
    await registry.compileAll(islandPaths);
    compileErrors = registry.getErrors();
    if (compileErrors.length > 0) {
      throw new Error(`[mochi:build] ${formatCompileErrors(compileErrors)}`);
    }
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
    // Runtime registers public files under the percent-encoded `publicRouteKey`,
    // so a route declared in encoded form (e.g. `/a%20b.txt`) would collide there
    // but slip past a raw-key check. Compare both forms.
    if (urlPath in options.routes || publicRouteKey(urlPath) in options.routes) {
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
    const destPath = path.join(outDir, 'public', ...urlPath.split('/').filter(Boolean));
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
