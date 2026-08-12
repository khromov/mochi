import { checkEnvironment } from './checkEnvironment';
import { ComponentRegistry, formatCompileErrors } from '../compiler/ComponentRegistry';
import { buildInlineWebComponent } from '../compiler/buildInlineWebComponent';
import { DEFAULT_ERROR_PAGE_PATH } from '../runtime/errors';
import { CLIENT_STATS_COMPONENT } from '../dev/clientStatsRoutes';
import { isMochiPage, isMochiApi, isMochiWs, isMochiSse } from '../types';
import type { MarkdownConfig, MochiBarrelWarningOptions, MochiClientBundleOptions, MochiRouteValue, MochiSvelteShakerOptions } from '../types';
import type { MochiSvelteCompiler } from '../compiler/svelteCompilerBackend';
import { rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { scanPublicDir, publicRouteKey } from '../runtime/publicDir';
import { scanEmailTemplates } from '../email/templates';
import { encodeSourcePath } from '../compiler/manifestPaths';
import { loadSvelteConfig } from '../compiler/svelteConfig';
import { logger, setLogLevel } from '../utils/log';
import { consoleLogger } from '../dev/consoleLogger';
import { mochiEvents } from '../events';
import type { MochiCompileCompleteEvent } from '../events';
import { styleText } from 'node:util';
import prettyBytes from '../vendor/pretty-bytes';
import { collectImageResources, printChunkTree, printResourceTree } from './resourceReport';

export interface MochiBuildOptions {
  routes: Record<string, MochiRouteValue>;
  development?: boolean;
  /** Base directory for build output (cwd-relative). Default: `./.mochi`. A `--dev` build nests under `<outDir>/dev`; production writes to the root. */
  outDir?: string;
  /** Static assets directory (cwd-relative). Default: `./public`. */
  publicDir?: string;
  /** Baked into the prebuilt manifest so the runtime server uses the same value. Default: `/_mochi`. See `MochiServeOptions['assetPrefix']`. */
  assetPrefix?: string;
  /** Path to a Svelte config file (cwd-relative or absolute). Default: `./svelte.config.js`. See `MochiServeOptions['svelteConfigPath']`. */
  svelteConfigPath?: string;
  /** Mirror the value passed to `Mochi.serve({ svelteCompiler })`. Default: `'svelte'`. See `MochiServeOptions['svelteCompiler']`. */
  svelteCompiler?: MochiSvelteCompiler;
  /** Mirror the value passed to `Mochi.serve({ markdown })` so the prebuild and the runtime share one pipeline. Omit to leave markdown unhandled. See `MochiServeOptions['markdown']`. */
  markdown?: MarkdownConfig;
  /** Mirror the value passed to `Mochi.serve({ optimize })` so the prebuilt manifest and the runtime agree. Default: `false`. See `MochiServeOptions['optimize']`. */
  optimize?: boolean | MochiSvelteShakerOptions;
  /** Mirror the value passed to `Mochi.serve({ clientBundle })`. Manual chunking runs in production builds only. See `MochiServeOptions['clientBundle']`. */
  clientBundle?: MochiClientBundleOptions;
  /** Mirror the value passed to `Mochi.serve({ barrelWarnings })`; a build collapses offenders into one grouped summary line. Default: enabled. See `MochiServeOptions['barrelWarnings']`. */
  barrelWarnings?: boolean | MochiBarrelWarningOptions;
  /** Mirror the value passed to `Mochi.serve({ errorPage })` so it lands in the manifest and the runtime skips compiling it at startup. Default: Mochi's built-in error page. */
  errorPage?: string;
  /** Mirror the value passed to `Mochi.serve({ build: { resources } })`. Default: enabled. See `MochiBuildReportOptions['resources']`. */
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
  const compileStats = new Map<string, { ssrSizeBytes: number; hydratableCount: number; serverIslandCount: number }>();
  const onCompileComplete = ({ path: p, ssrSizeBytes, hydratableCount, serverIslandCount }: MochiCompileCompleteEvent) => {
    compileStats.set(p, { ssrSizeBytes, hydratableCount, serverIslandCount });
  };
  // Removed in the trailing finally — build() runs in-process from tests, so a
  // leaked listener would survive into subsequent builds in the same process.
  mochiEvents.on('client-bundle:complete', onClientBundle);
  mochiEvents.on('compile:complete', onCompileComplete);
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
      clientBundle: options.clientBundle,
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
    const errorPagePath = options.errorPage ?? DEFAULT_ERROR_PAGE_PATH;
    const ssrEntrypoints: string[] = [errorPagePath, CLIENT_STATS_COMPONENT];
    const allRoutes: RouteEntry[] = [];

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

    // Email templates are reachable only through `Mochi.email({ component })` at runtime, so no import graph leads here
    // from a route. Walking the conventional directory is what keeps them out of a cold compile on the first send.
    const emailTemplates = scanEmailTemplates();
    ssrEntrypoints.push(...emailTemplates);

    if (ssrEntrypoints.length > 0) {
      await timed('pages', () => registry.compileAll(ssrEntrypoints, { deferClientBundle: true }));
    }

    let compileErrors = registry.getErrors();
    if (compileErrors.length > 0) {
      throw new Error(`[mochi:build] ${formatCompileErrors(compileErrors)}`);
    }

    // The pass above compiled every one of these, so a missing stat is a framework regression rather than anything the
    // user did — throwing keeps it loud instead of silently disarming both island guards below.
    const emailStats = emailTemplates.map((file) => {
      const stats = compileStats.get(path.resolve(file));
      if (!stats) {
        throw new Error(`[mochi:build] no compile stats for email template ${file} — its island guards can't run.`);
      }
      return { file, ...stats };
    });

    // Until the build compiled these, an island in an email template surfaced only as a render-time throw on the first
    // send. Now that they're in the bundle it would also emit client JS no email client can run, so fail here instead.
    // Mirrors renderStatic()'s hydratable guard, which is import-graph based and fires regardless of props.
    const emailWithIslands = emailStats.filter((s) => s.hydratableCount > 0).map((s) => s.file);
    if (emailWithIslands.length > 0) {
      throw new Error(
        `[mochi:build] Email templates can't contain islands:\n` +
          emailWithIslands.map((f) => `  - ${f}`).join('\n') +
          `\nmochi:hydrate* / mochi:clientOnly need client JS, which an email can't run — render the content inline instead.`,
      );
    }

    // Stricter than renderStatic()'s own server-island guard, which is post-render and greps the output for the
    // placeholder, so it lets through a `mochi:defer` behind a branch that never renders. The import graph catches that
    // one too — an email template has no business referencing a server island at all.
    const emailWithServerIslands = emailStats.filter((s) => s.serverIslandCount > 0).map((s) => s.file);
    if (emailWithServerIslands.length > 0) {
      throw new Error(
        `[mochi:build] Email templates can't contain server islands:\n` +
          emailWithServerIslands.map((f) => `  - ${f}`).join('\n') +
          `\nmochi:defer* loads over a follow-up request an email can't make — render the content inline instead.`,
      );
    }

    // Precompiling `mochi:defer` islands as standalone SSR modules keeps the production runtime off the compile path,
    // which the first fetch of each deferred island would otherwise trigger. Discovery is eager because a
    // `mochi:defer` island's import survives in its compiled source — only the markup usage is rewritten — so compiling
    // a page transitively resolves every island it references. Anything eager discovery misses just stays out of the
    // manifest, and the server-island endpoint warns and falls back to an on-demand compile.
    const islandPaths = [...new Set(registry.getServerIslandPaths().values())];
    if (islandPaths.length > 0) {
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
    printBuildTree({
      routes: allRoutes,
      errorPage: errorPagePath,
      emails: emailStats,
      // Sorted by name, not by the map's compile order, so a rebuild of unchanged sources prints an identical tree.
      islands: [...registry.getServerIslandPaths()].sort(([a], [b]) => a.localeCompare(b)),
      assetPrefix: registry.assetPrefix,
      stats: compileStats,
    });

    // After finalizeClientBundle() above, so assets the client pass emitted are
    // in the map too (both passes share it, keyed by served URL).
    const imageAssets = registry.getLocalImageAssets();
    if (options.resources !== false) {
      printResourceTree(collectImageResources(imageAssets.values()));
    }

    const chunkRows = (registry.getClientStats()?.outputs ?? [])
      .filter((o): o is typeof o & { chunkName: string } => typeof o.chunkName === 'string')
      .map((o) => ({ chunkName: o.chunkName, file: o.name, modules: o.inputs.length, bytes: o.size }));
    printChunkTree(chunkRows, registry.getSkippedChunkModules());

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
    // Recorded here rather than in `toManifest()`, since the registry holds no public files: this is the build's own
    // count, and the only evidence at boot that static files existed when it ran.
    manifest.publicFileCount = publicFileCount;
    await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));

    const clientFileCount = Object.keys(manifest.clientFiles).length;
    const phaseSummary = phases.map((p) => `${p.name} ${formatDuration(p.ms)}`).join(' · ');
    logger.info(`build: phases — ${phaseSummary} (client bundle ×${clientBundleCount}, ${formatDuration(clientBundleMs)})`);
    const elapsed = formatDuration(performance.now() - startedAt);
    const emailSummary = emailTemplates.length > 0 ? `, ${emailTemplates.length} email template(s)` : '';
    logger.info(
      `build: done in ${elapsed}. ${compiledPages.length} page(s), ${clientFileCount} client file(s), ${publicFileCount} public file(s), ${imageAssets.size} image asset(s)${emailSummary}. Manifest written to ${manifestPath}`,
    );
  } finally {
    mochiEvents.off('client-bundle:complete', onClientBundle);
    mochiEvents.off('compile:complete', onCompileComplete);
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

// Same full/empty distinction as `pageSymbol`, in the server island's own colour: a server island is a render of its
// own, so it can carry hydratable children just like a page can.
function serverIslandSymbol(hyd: number | null): string {
  return styleText('magenta', hyd != null && hyd > 0 ? '◐' : '○');
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

interface TreeRow {
  symbol: string;
  /** Rendered with `:param` segments highlighted, so it must stay plain text until print time. */
  label: string;
  hyd: number | null;
  ssr: string | null;
}

interface TreeGroup {
  heading: string;
  rows: TreeRow[];
}

function statRow(symbol: string, label: string, stats: BuildTreeInput['stats'], componentPath: string | undefined): TreeRow {
  // `compile:complete` reports resolved absolute paths; route registrations and
  // `errorPage` are whatever the user wrote (usually './src/X.svelte').
  const s = componentPath ? stats.get(path.resolve(componentPath)) : undefined;
  return { symbol, label, hyd: s?.hydratableCount ?? null, ssr: s ? prettyBytes(s.ssrSizeBytes) : null };
}

interface BuildTreeInput {
  routes: RouteEntry[];
  /** As passed to `Mochi.serve({ errorPage })`, or Mochi's built-in when unset — either way it lands in the manifest. */
  errorPage: string;
  emails: { file: string; ssrSizeBytes: number }[];
  /** `[islandName, resolvedPath]`, as `ComponentRegistry.getServerIslandPaths()` records them. */
  islands: [string, string][];
  assetPrefix: string;
  stats: Map<string, { ssrSizeBytes: number; hydratableCount: number }>;
}

/**
 * Every SSR entrypoint the build produced, as one connected list: routes, then the error page, email templates, and
 * server islands. The trailing groups are separated because no route reaches them — they render on a throw, on a send,
 * and on a fetch of their own endpoint — but they share the column widths and the legend so the whole thing reads as a
 * single report.
 */
function printBuildTree({ routes, errorPage, emails, islands, assetPrefix, stats }: BuildTreeInput): void {
  const routeRows = routes.map(({ pattern, kind, componentPath }) => {
    const row = statRow('', pattern, stats, componentPath);
    // A page's symbol depends on its hydratable count, so it can only be picked once the stats lookup has resolved.
    return { ...row, symbol: kind === 'page' ? pageSymbol(row.hyd) : kindSymbol(kind), kind };
  });

  const groups: TreeGroup[] = [{ heading: 'Route', rows: routeRows }];
  groups.push({ heading: 'Error page', rows: [statRow(styleText('yellow', '⚠'), encodeSourcePath(errorPage), stats, errorPage)] });
  if (emails.length > 0) {
    groups.push({
      heading: 'Email template',
      // `hyd: null` renders as `-` rather than `0`: an island in a template fails the build, so the column can't apply.
      rows: emails.map((e) => ({ symbol: styleText('cyan', '✉'), label: e.file, hyd: null, ssr: prettyBytes(e.ssrSizeBytes) })),
    });
  }
  // Labelled by endpoint rather than by file: the name is what the browser fetches, and two islands can share a source
  // file (named exports) while each keeps its own URL.
  const islandRows = islands.map(([name, resolvedPath]) => {
    const row = statRow('', `${assetPrefix}/island/${name}`, stats, resolvedPath);
    return { ...row, symbol: serverIslandSymbol(row.hyd) };
  });
  if (islandRows.length > 0) {
    groups.push({ heading: 'Server island', rows: islandRows });
  }

  const allRows = groups.flatMap((g) => g.rows);
  if (allRows.length === 0) {
    return;
  }

  const labelWidth = Math.max(...groups.map((g) => g.heading.length), ...allRows.map((r) => r.label.length));
  const islandsWidth = 'islands'.length;
  const bundleWidth = Math.max('bundle'.length, ...allRows.map((r) => r.ssr?.length ?? 0));

  const n = allRows.length;
  let i = 0;
  for (const [groupIndex, group] of groups.entries()) {
    if (groupIndex === 0) {
      // "  ┌ ● " = 6 chars — header indent matches
      console.log(styleText('dim', `      ${group.heading.padEnd(labelWidth + 2)}  ${'islands'.padStart(islandsWidth)}  ${'bundle'.padStart(bundleWidth)}`));
    } else {
      // The `│` keeps the run unbroken across the gap, so the groups read as sections of one list rather than as
      // separate tables that happen to share a column layout.
      console.log(styleText('dim', '  │'));
      console.log(styleText('dim', `  │   ${group.heading}`));
    }

    for (const { symbol, label, hyd, ssr } of group.rows) {
      const char = styleText('dim', n === 1 ? '─' : i === 0 ? '┌' : i === n - 1 ? '└' : '├');
      const coloredLabel = label.padEnd(labelWidth + 2).replace(/:[^/\s]+/g, (s: string) => styleText('cyan', s));
      const hydStr = hyd != null ? styleText('green', String(hyd).padStart(islandsWidth)) : styleText('dim', '-'.padStart(islandsWidth));
      const ssrStr = styleText('dim', (ssr ?? '-').padStart(bundleWidth));
      console.log(`  ${char} ${symbol} ${coloredLabel}  ${hydStr}  ${ssrStr}`);
      i++;
    }
  }

  const legendEntries: string[] = [];
  if (routeRows.some((r) => r.kind === 'page' && r.hyd != null && r.hyd > 0)) {
    legendEntries.push(`${styleText('green', '●')} page with islands`);
  }
  if (routeRows.some((r) => r.kind === 'page' && (r.hyd === null || r.hyd === 0))) {
    legendEntries.push(`${styleText('cyan', '○')} ssr-only page`);
  }
  if (routeRows.some((r) => r.kind === 'api')) {
    legendEntries.push(`${styleText('magenta', 'λ')} api`);
  }
  if (routeRows.some((r) => r.kind === 'ws')) {
    legendEntries.push(`${styleText('blue', '⇄')} websocket`);
  }
  if (routeRows.some((r) => r.kind === 'sse')) {
    legendEntries.push(`${styleText('green', '→')} sse`);
  }
  legendEntries.push(`${styleText('yellow', '⚠')} error page`);
  if (emails.length > 0) {
    legendEntries.push(`${styleText('cyan', '✉')} email template`);
  }
  if (islandRows.some((r) => r.hyd != null && r.hyd > 0)) {
    legendEntries.push(`${styleText('magenta', '◐')} server island with islands`);
  }
  if (islandRows.some((r) => r.hyd === null || r.hyd === 0)) {
    legendEntries.push(`${styleText('magenta', '○')} server island`);
  }
  console.log(`\n  ${legendEntries.join(styleText('dim', '  ·  '))}`);
}
