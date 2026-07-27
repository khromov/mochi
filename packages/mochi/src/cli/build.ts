import { checkEnvironment } from './checkEnvironment';
import { ComponentRegistry, formatCompileErrors } from '../compiler/ComponentRegistry';
import { buildInlineWebComponent } from '../compiler/buildInlineWebComponent';
import { DEFAULT_ERROR_PAGE_PATH } from '../runtime/errors';
import { CLIENT_STATS_COMPONENT } from '../dev/clientStatsRoutes';
import { isMochiPage, isMochiApi, isMochiWs, isMochiSse } from '../types';
import type { MarkdownConfig, MochiBarrelWarningOptions, MochiRouteValue, MochiSvelteShakerOptions } from '../types';
import type { MochiSvelteCompiler } from '../compiler/svelteCompilerBackend';
import { rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { scanPublicDir, publicRouteKey } from '../runtime/publicDir';
import { loadSvelteConfig } from '../compiler/svelteConfig';
import { logger, setLogLevel } from '../utils/log';
import { consoleLogger } from '../dev/consoleLogger';
import { mochiEvents } from '../events';
import { styleText } from 'node:util';
import prettyBytes from '../vendor/pretty-bytes';
import { collectImageResources, printResourceTree } from './resourceReport';

export interface MochiBuildOptions {
  routes: Record<string, MochiRouteValue>;
  development?: boolean;
  /** Base directory for build output (cwd-relative). Default: `./.mochi`. A `--dev` build nests under `<outDir>/dev`; production writes to the root. */
  outDir?: string;
  /** Static assets directory (cwd-relative). Default: `./public`. */
  publicDir?: string;
  /** Baked into the prebuilt manifest so the runtime server uses the same value. See `MochiServeOptions['assetPrefix']`. */
  assetPrefix?: string;
  /** See `MochiServeOptions['svelteConfigPath']`. */
  svelteConfigPath?: string;
  /** Mirror the value passed to `Mochi.serve({ svelteCompiler })`. See `MochiServeOptions['svelteCompiler']`. */
  svelteCompiler?: MochiSvelteCompiler;
  /** Mirror the value passed to `Mochi.serve({ markdown })` so the prebuild and the runtime share one pipeline. See `MochiServeOptions['markdown']`. */
  markdown?: MarkdownConfig;
  /** Mirror the value passed to `Mochi.serve({ optimize })` so the prebuilt manifest and the runtime agree. See `MochiServeOptions['optimize']`. */
  optimize?: boolean | MochiSvelteShakerOptions;
  /** Mirror the value passed to `Mochi.serve({ barrelWarnings })`; a build collapses offenders into one grouped summary line. See `MochiServeOptions['barrelWarnings']`. */
  barrelWarnings?: boolean | MochiBarrelWarningOptions;
  /** Mirror the value passed to `Mochi.serve({ errorPage })` so it lands in the manifest and the runtime skips compiling it at startup. */
  errorPage?: string;
  /** Mirror the value passed to `Mochi.serve({ build: { resources } })`. See `MochiBuildReportOptions['resources']`. */
  resources?: boolean;
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
  const phases: { name: string; ms: number }[] = [];
  // Entries are pushed at call time so the summary line lists phases in start
  // order (stable across runs) even though overlapped phases finish out of order.
  async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const entry = { name, ms: 0 };
    phases.push(entry);
    const t0 = performance.now();
    const result = await fn();
    entry.ms = performance.now() - t0;
    return result;
  }
  let clientBundleCount = 0;
  let clientBundleMs = 0;
  const onClientBundle = ({ durationMs }: { durationMs: number }) => {
    clientBundleCount += 1;
    clientBundleMs += durationMs;
  };
  // Removed in the trailing finally — build() runs in-process from tests, so a
  // leaked listener would survive into subsequent builds in the same process.
  mochiEvents.on('client-bundle:complete', onClientBundle);
  try {
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

    // Started now so it overlaps the compile phases, and awaited before the manifest. The `.catch(() => {})` guard only
    // marks a rejection handled in case compileAll throws first; the real error still surfaces at the trailing `await`.
    // `timed` wraps the work rather than that await, so the phase line reports real duration, not residual wait.
    const serverIslandScriptPromise = timed('island-script', () => buildInlineWebComponent('./web-components/ServerIsland.ts'));
    serverIslandScriptPromise.catch(() => {});
    // The runtime serves static files straight from publicDir in every mode, so all the build adds is proof that no
    // public file shadows a declared route and a deploy silently drops an asset. The runtime's own
    // `registerPublicRoutes` check stays warn-and-skip, covering the case this one can't — a file dropped into publicDir
    // after the build. Awaited inline, since a glob with no copy fails a collision in milliseconds.
    const publicFileCount = await timed('public', async () => {
      const publicSrc = await scanPublicDir(publicDir);
      const conflicts: string[] = [];
      for (const urlPath of publicSrc.keys()) {
        // The runtime registers public files under the percent-encoded `publicRouteKey`, so a route declared encoded
        // (`/a%20b.txt`) collides there while slipping past a raw-key check — hence comparing both forms.
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
      return publicSrc.size;
    });

    const svelteConfig = await loadSvelteConfig(options.svelteConfigPath);
    const registry = new ComponentRegistry({
      development,
      outDir,
      assetPrefix: options.assetPrefix,
      svelteConfig,
      svelteCompiler: options.svelteCompiler,
      markdown: options.markdown,
      optimize: options.optimize,
      barrelWarnings: options.barrelWarnings,
      // Group offenders into one summary for the one-shot production build; a
      // `--dev` build keeps the dev server's immediate per-package lines.
      bufferBarrelWarnings: !development,
    });
    await timed('shake', () => registry.prepareShake());

    // One `Bun.build` for every `Mochi.page()` handler emits transitive deps as shared chunks alongside the per-page
    // `.server.js` files instead of inlining them into each page.
    const compiledPages: string[] = [];
    // Seeding the framework components `Mochi.serve()` would otherwise compile at startup — the error page and the
    // client-stats admin page — makes the boot-time compileAll a no-op in production.
    const ssrEntrypoints: string[] = [options.errorPage ?? DEFAULT_ERROR_PAGE_PATH, CLIENT_STATS_COMPONENT];
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
      await timed('pages', () => registry.compileAll(ssrEntrypoints, { deferClientBundle: true }));
    }

    let compileErrors = registry.getErrors();
    if (compileErrors.length > 0) {
      throw new Error(`[mochi:build] ${formatCompileErrors(compileErrors)}`);
    }

    // Precompiling `mochi:defer` islands as standalone SSR modules keeps the production runtime off the compile path,
    // which the first fetch of each deferred island would otherwise trigger. Discovery is eager because a
    // `mochi:defer` island's import survives in its compiled source — only the markup usage is rewritten — so compiling
    // a page transitively resolves every island it references. Anything eager discovery misses just stays out of the
    // manifest, and the server-island endpoint warns and falls back to an on-demand compile.
    const islandPaths = [...new Set(registry.getServerIslandPaths().values())];
    if (islandPaths.length > 0) {
      logger.info(`[mochi:build] precompiling ${islandPaths.length} server island(s): ${islandPaths.map((p) => path.basename(p)).join(', ')}`);
      await timed('islands', () => registry.compileAll(islandPaths, { deferClientBundle: true }));
      compileErrors = registry.getErrors();
      if (compileErrors.length > 0) {
        throw new Error(`[mochi:build] ${formatCompileErrors(compileErrors)}`);
      }
    }

    // Both compileAll passes above defer the client bundle so the second pass
    // doesn't rebuild the same monolithic bundle the first one just produced.
    await timed('client-bundle', () => registry.finalizeClientBundle());

    // Flush after every compile pass — including the deferred client bundle — so
    // island-only and client-only barrels are in the summary.
    registry.flushBarrelWarnings();

    allRoutes.sort((a, b) => a.pattern.localeCompare(b.pattern, undefined, { numeric: true }));
    printRouteTree(allRoutes, compileStats);

    // After finalizeClientBundle() above, so assets the client pass emitted are
    // in the map too (both passes share it, keyed by served URL).
    const imageAssets = registry.getLocalImageAssets();
    if (options.resources !== false) {
      printResourceTree(collectImageResources(imageAssets.values()));
    }

    // Clean up intermediate .raw.css files
    const cssDir = path.join(outDir, 'svelte-css');
    const glob = new Bun.Glob('*.raw.css');
    for (const raw of glob.scanSync(cssDir)) {
      rmSync(path.join(cssDir, raw));
    }

    // Prebuilt so the production runtime loads it from disk instead of running `Bun.build` at boot.
    const serverIslandScriptPath = path.join(outDir, 'server-island.js');
    const serverIslandJs = await serverIslandScriptPromise;
    await Bun.write(serverIslandScriptPath, serverIslandJs);
    registry.setServerIslandScript(serverIslandScriptPath, serverIslandJs);

    // Write manifest
    const manifestPath = path.join(outDir, 'manifest.json');
    const manifest = registry.toManifest();
    await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));

    const clientFileCount = Object.keys(manifest.clientFiles).length;
    const phaseSummary = phases.map((p) => `${p.name} ${formatDuration(p.ms)}`).join(' · ');
    logger.info(`build: phases — ${phaseSummary} (client bundle ×${clientBundleCount}, ${formatDuration(clientBundleMs)})`);
    const elapsed = formatDuration(performance.now() - startedAt);
    logger.info(
      `build: done in ${elapsed}. ${compiledPages.length} page(s), ${clientFileCount} client file(s), ${publicFileCount} public file(s), ${imageAssets.size} image asset(s). Manifest written to ${manifestPath}`,
    );
  } finally {
    mochiEvents.off('client-bundle:complete', onClientBundle);
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

async function readMochiVersion(): Promise<string> {
  const pkgPath = path.join(import.meta.dir, '..', '..', 'package.json');
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
    // `compile:complete` reports resolved absolute paths; route registrations
    // are whatever the user wrote (usually './src/X.svelte').
    const s = componentPath ? stats.get(path.resolve(componentPath)) : undefined;
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
