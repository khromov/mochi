import type { Server, ServerWebSocket } from 'bun';
import { existsSync } from 'fs';
import path from 'node:path';
import { createWatcher } from './lib/fileWatcher';
import debounce from './vendor/debounce/index';
import type { ComponentRegistry } from './ComponentRegistry';
import { mochiEvents } from './events';
import type { MochiFileChangeType } from './events';
import { logger } from './log';
import { evictPreprocessCacheEntry } from './preprocessCache';
import { extractServeOptions } from './extractServeOptions';
import { buildPublicUrl } from './proxy';
import { resolvePublicFiles, registerPublicRoutes } from './publicDir';
import { loadSvelteConfig } from './svelteConfig';
import { alternateSlashPattern } from './trailingSlash';
import {
  isMochiApi,
  isMochiPage,
  isMochiSse,
  isMochiWs,
  type BunRouteValue,
  type MochiApiHandler,
  type MochiPageHandlerConfig,
  type MochiRouteValue,
  type MochiServeOptions,
  type MochiSseHandler,
  type MochiWsData,
  type MochiWsHandlers,
  type RouteRegistrationResult,
} from './types';

const FILE_CHANGE_EVENTS = new Set<string>(['add', 'change', 'unlink', 'addDir', 'unlinkDir']);

// A rename surfaces as unlink-old + add-new, so logging the verb per event
// surfaces both the old and new filename instead of just "changed".
function publicChangeVerb(event: string): string {
  if (event === 'add' || event === 'addDir') {
    return 'added';
  }
  if (event === 'unlink' || event === 'unlinkDir') {
    return 'removed';
  }
  return 'changed';
}

export interface DevWatcherDeps {
  registry: ComponentRegistry;
  server: Server<undefined>;
  options: MochiServeOptions;
  liveReloadClients: Set<ServerWebSocket<MochiWsData>>;
  composedFetch: (req: Request, server: Server<undefined>) => Promise<Response>;
  baseBunRoutes: Record<string, BunRouteValue>;
  bunRoutes: Record<string, BunRouteValue>;
  outDir: string;
  publicDir: string;
  watchPaths: string[];
  development: boolean;
  entryPath: string;
  apiHandlerMap?: Map<string, MochiApiHandler>;
  sseHandlerMap?: Map<string, MochiSseHandler>;
  wsHandlersMap?: Map<string, MochiWsHandlers<unknown>>;
  pageConfigMap?: Map<string, MochiPageHandlerConfig>;
  registerRoutePattern?: (pattern: string, handler: MochiRouteValue) => Promise<RouteRegistrationResult | null>;
  unregisterRoutePattern?: (pattern: string) => void;
  trailingSlashPolicy?: 'never' | 'always';
  shellPath?: string;
  reloadShell?: () => Promise<void>;
}

/**
 * Wire up the dev-mode file watcher over the source tree, public dir, and
 * `svelte.config.js`. Saves are debounced (100 ms) and serialized
 * through a Promise chain so the live-reload signal only fires after client
 * chunks are ready. CSS edits take a fast-path that re-bundles imported CSS
 * without an SSR recompile; public-dir edits rescan and reload the route map.
 */
export function startDevWatcher(deps: DevWatcherDeps): Promise<void> {
  const {
    registry,
    server,
    options,
    liveReloadClients,
    composedFetch,
    baseBunRoutes,
    bunRoutes,
    outDir,
    publicDir,
    watchPaths,
    development,
    entryPath,
    apiHandlerMap,
    sseHandlerMap,
    wsHandlersMap,
    pageConfigMap,
    registerRoutePattern,
    unregisterRoutePattern,
    trailingSlashPolicy,
    shellPath,
    reloadShell,
  } = deps;

  const liveReloadHandler = (req: Request, srv: Server<undefined>): Response => {
    const url = buildPublicUrl(req, options.proxy);
    const entryParam = url.searchParams.get('entry') ?? undefined;
    const success = (
      srv as unknown as {
        upgrade: (req: Request, opts: Record<string, unknown>) => boolean;
      }
    ).upgrade(req, {
      data: {
        __mochiRoutePattern: '/__mochi_live_reload',
        __mochiOpenedAt: performance.now(),
        __mochiPath: url.pathname,
        __mochiEntry: entryParam,
        user: undefined,
      } satisfies MochiWsData,
    });
    if (!success) {
      return new Response('WebSocket upgrade failed', { status: 400 });
    }
    return undefined as unknown as Response;
  };

  // When `affected` is provided, only tabs whose entry is in that set
  // get the reload — tabs on unaffected pages keep their state.
  const notifyClients = (affected?: Set<string>) => {
    for (const client of liveReloadClients) {
      if (affected !== undefined) {
        const entry = client.data.__mochiEntry;
        if (entry !== undefined && !affected.has(entry)) {
          continue;
        }
      }
      try {
        client.send('reload');
      } catch {
        liveReloadClients.delete(client);
      }
    }
  };

  // Serialize rebuilds through a Promise chain so the WebSocket reload only
  // fires after client JS chunks are ready. If multiple saves arrive
  // mid-rebuild, each is appended to the chain — the browser reloads once,
  // into fresh chunks.
  let reloadChain: Promise<void> = Promise.resolve();
  const triggerReload = debounce((filename: string) => {
    reloadChain = reloadChain.then(async () => {
      // pageCount on the start event is the universe size, not the
      // affected size — the watcher doesn't know which pages depend on
      // the changed file until recompileChanged inspects the graph.
      mochiEvents.emit('recompile:start', { trigger: 'file', path: filename, pageCount: registry.getPageCount() });
      const start = performance.now();
      let summary: { pages: Set<string>; clientBundleCount: number } = { pages: new Set(), clientBundleCount: 0 };
      let failed = false;
      try {
        summary = await registry.recompileChanged(filename);
        if (summary.pages.size === 0) {
          const resolved = path.resolve(filename);
          const componentPath = routeComponentPaths.get(resolved);
          if (componentPath) {
            await registry.compile(componentPath, { force: true });
            summary = { pages: new Set([resolved]), clientBundleCount: 0 };
          }
        }
      } catch (e) {
        failed = true;
        logger.warn(`Rebuild failed: ${e instanceof Error ? e.message : e}`);
      }
      mochiEvents.emit('recompile:complete', {
        trigger: 'file',
        path: filename,
        pageCount: summary.pages.size,
        pages: [...summary.pages],
        clientBundleCount: summary.clientBundleCount,
        durationMs: performance.now() - start,
      });
      if (failed) {
        // Rebuild threw before the affected set could be returned — we
        // can't scope the reload, so broadcast so every tab refreshes
        // and the error overlay (rendered into the next response from
        // accumulated registry errors) surfaces.
        notifyClients();
      } else if (summary.pages.size > 0) {
        notifyClients(summary.pages);
      }
      // else: succeeded with empty `affected` (e.g. server-only edit
      // that no entry depends on) — nothing to reload, skip silently.
    });
  }, 100);

  // Fast-path for .css edits: re-bundle only the CSS imports (still
  // serialized through the same chain so a CSS save mid-rebuild waits its
  // turn). Skips the full SSR recompile.
  const triggerCssReload = debounce((filename: string) => {
    reloadChain = reloadChain.then(async () => {
      mochiEvents.emit('recompile:start', { trigger: 'css', path: filename, pageCount: 0 });
      const start = performance.now();
      try {
        await registry.rebundleImportedCss();
      } catch (e) {
        logger.warn(`CSS rebundle failed: ${e instanceof Error ? e.message : e}`);
      }
      mochiEvents.emit('recompile:complete', {
        trigger: 'css',
        path: filename,
        pageCount: 0,
        pages: [],
        clientBundleCount: 0,
        durationMs: performance.now() - start,
      });
      // CSS bundles aren't scoped per-page, so reload every tab.
      notifyClients();
    });
  }, 100);

  // The HTML shell is read once at startup and isn't part of any page's Svelte
  // dependency graph, so a generic recompile would report 0 affected pages and
  // skip the reload. Re-read it and broadcast — every page may depend on the
  // shell's styling/head/scripts, so all tabs reload.
  const triggerShellReload = reloadShell
    ? debounce((filename: string) => {
        reloadChain = reloadChain.then(async () => {
          mochiEvents.emit('recompile:start', { trigger: 'html-shell', path: filename, pageCount: 0 });
          const start = performance.now();
          try {
            await reloadShell();
          } catch (e) {
            logger.warn(`Shell reload failed: ${e instanceof Error ? e.message : e}`);
          }
          mochiEvents.emit('recompile:complete', {
            trigger: 'html-shell',
            path: filename,
            pageCount: 0,
            pages: [],
            clientBundleCount: 0,
            durationMs: performance.now() - start,
          });
          notifyClients();
        });
      }, 250)
    : undefined;

  // --- Entry-based route HMR ---
  // Build the entry module to discover its transitive deps. When a dep changes,
  // rebuild and re-extract routes via extractServeOptions, then hot-swap
  // handlers in place so the running server picks up route changes without a
  // restart.
  let entryDeps: Set<string> = new Set();
  const entryBuildOutDir = path.resolve(`${outDir}/entry-hmr`);

  async function buildEntry(): Promise<Record<string, unknown> | null> {
    const result = await Bun.build({
      entrypoints: [path.resolve(entryPath)],
      packages: 'external',
      target: 'bun',
      outdir: entryBuildOutDir,
      naming: { entry: 'entry.js' },
      metafile: true,
      throw: false,
    });
    if (!result.success) {
      const msgs = result.logs.map((l) => l.message || String(l)).join('\n');
      logger.warn(`Entry rebuild failed:\n${msgs}`);
      return null;
    }
    const newDeps = new Set<string>();
    if (result.metafile) {
      for (const output of Object.values(result.metafile.outputs)) {
        for (const inputPath of Object.keys(output.inputs)) {
          newDeps.add(path.resolve(inputPath));
        }
      }
    }
    entryDeps = newDeps;
    const outFile = path.resolve(entryBuildOutDir, 'entry.js');
    const serveOptions = await extractServeOptions(outFile, { fresh: true });
    if (!serveOptions?.routes) {
      logger.warn('Entry rebuild produced no routes — skipping update');
      return null;
    }
    const freshRoutes = serveOptions.routes as Record<string, unknown>;

    const newComponentPaths = new Map<string, string>();
    for (const handler of Object.values(freshRoutes)) {
      if (isMochiPage(handler)) {
        newComponentPaths.set(path.resolve(handler.componentPath), handler.componentPath);
      }
    }
    routeComponentPaths = newComponentPaths;

    return freshRoutes;
  }

  let knownEntryPatterns = new Set<string>();
  let routeComponentPaths: Map<string, string> = new Map();

  function routeType(handler: unknown): 'api' | 'ws' | 'sse' | 'page' | null {
    if (isMochiApi(handler)) {
      return 'api';
    }
    if (isMochiWs(handler)) {
      return 'ws';
    }
    if (isMochiSse(handler)) {
      return 'sse';
    }
    if (isMochiPage(handler)) {
      return 'page';
    }
    return null;
  }

  function currentRouteType(pattern: string): 'api' | 'ws' | 'sse' | 'page' | null {
    if (apiHandlerMap?.has(pattern)) {
      return 'api';
    }
    if (wsHandlersMap?.has(pattern)) {
      return 'ws';
    }
    if (sseHandlerMap?.has(pattern)) {
      return 'sse';
    }
    if (pageConfigMap?.has(pattern)) {
      return 'page';
    }
    return null;
  }

  function addBunRoute(pattern: string, value: BunRouteValue): void {
    bunRoutes[pattern] = value;
    baseBunRoutes[pattern] = value;
    if (trailingSlashPolicy) {
      const alt = alternateSlashPattern(pattern);
      if (alt && !(alt in bunRoutes)) {
        bunRoutes[alt] = value;
        baseBunRoutes[alt] = value;
      }
    }
  }

  function removeBunRoute(pattern: string): void {
    if (trailingSlashPolicy) {
      const alt = alternateSlashPattern(pattern);
      if (alt) {
        delete bunRoutes[alt];
        delete baseBunRoutes[alt];
      }
    }
    delete bunRoutes[pattern];
    delete baseBunRoutes[pattern];
  }

  async function applyRouteChanges(
    freshRoutes: Record<string, unknown>,
  ): Promise<{ updated: number; added: string[]; removed: string[]; api: number; ws: number; sse: number; page: number; file: number }> {
    const counts = { updated: 0, added: [] as string[], removed: [] as string[], api: 0, ws: 0, sse: 0, page: 0, file: 0 };
    const freshPatterns = new Set(Object.keys(freshRoutes));

    for (const [pattern, handler] of Object.entries(freshRoutes)) {
      const type = routeType(handler);
      if (!type) {
        continue;
      }

      if (knownEntryPatterns.has(pattern)) {
        const currentType = currentRouteType(pattern);

        if (currentType && currentType !== type && registerRoutePattern && unregisterRoutePattern) {
          unregisterRoutePattern(pattern);
          removeBunRoute(pattern);
          const result = await registerRoutePattern(pattern, handler as MochiRouteValue);
          if (result) {
            addBunRoute(pattern, result.bunRouteValue);
            counts.added.push(pattern);
            counts.removed.push(pattern);
          }
        } else {
          if (isMochiApi(handler) && apiHandlerMap?.has(pattern)) {
            apiHandlerMap.set(pattern, handler.handler);
            counts.api++;
            counts.updated++;
          } else if (isMochiWs(handler) && wsHandlersMap?.has(pattern)) {
            wsHandlersMap.set(pattern, handler.handlers as MochiWsHandlers<unknown>);
            counts.ws++;
            counts.updated++;
          } else if (isMochiSse(handler) && sseHandlerMap?.has(pattern)) {
            sseHandlerMap.set(pattern, handler.handler);
            counts.sse++;
            counts.updated++;
          } else if (isMochiPage(handler) && pageConfigMap?.has(pattern)) {
            pageConfigMap.set(pattern, { serverProps: handler.serverProps, actions: handler.actions });
            counts.page++;
            counts.updated++;
          }
        }
      } else if (registerRoutePattern) {
        try {
          const result = await registerRoutePattern(pattern, handler as MochiRouteValue);
          if (result) {
            addBunRoute(pattern, result.bunRouteValue);
            counts[result.type]++;
            counts.added.push(pattern);
          }
        } catch (e) {
          logger.warn(`Failed to register route ${pattern}: ${e instanceof Error ? e.message : e}`);
          counts.added.push(pattern);
        }
      }
    }

    if (unregisterRoutePattern) {
      for (const pattern of knownEntryPatterns) {
        if (!freshPatterns.has(pattern)) {
          unregisterRoutePattern(pattern);
          removeBunRoute(pattern);
          counts.removed.push(pattern);
        }
      }
    }

    knownEntryPatterns = freshPatterns;
    return counts;
  }

  const triggerEntryReload = debounce((filename: string) => {
    reloadChain = reloadChain.then(async () => {
      mochiEvents.emit('recompile:start', { trigger: 'entry', path: filename, pageCount: 0 });
      const start = performance.now();
      let counts: { updated: number; added: string[]; removed: string[]; api: number; ws: number; sse: number; page: number; file: number } = {
        updated: 0,
        added: [],
        removed: [],
        api: 0,
        ws: 0,
        sse: 0,
        page: 0,
        file: 0,
      };
      try {
        const freshRoutes = await buildEntry();
        if (freshRoutes) {
          counts = await applyRouteChanges(freshRoutes);
          const hasChanges = counts.updated > 0 || counts.added.length > 0 || counts.removed.length > 0;
          if (hasChanges) {
            const parts: string[] = [];
            if (counts.api) {
              parts.push(`${counts.api} api`);
            }
            if (counts.ws) {
              parts.push(`${counts.ws} ws`);
            }
            if (counts.sse) {
              parts.push(`${counts.sse} sse`);
            }
            if (counts.page) {
              parts.push(`${counts.page} page`);
            }
            if (counts.added.length) {
              parts.push(`+${counts.added.length} new`);
            }
            if (counts.removed.length) {
              parts.push(`-${counts.removed.length} removed`);
            }
            logger.info(`Entry rebuilt — ${parts.join(', ')}`);
          }
          if (counts.added.length > 0 || counts.removed.length > 0) {
            server.reload({
              routes: {
                ...bunRoutes,
                '/__mochi_live_reload': liveReloadHandler,
              },
              fetch: composedFetch,
            } as Parameters<typeof server.reload>[0]);
          }
        }
      } catch (e) {
        logger.warn(`Entry rebuild failed: ${e instanceof Error ? e.message : e}`);
      }
      mochiEvents.emit('recompile:complete', {
        trigger: 'entry',
        path: filename,
        pageCount: 0,
        pages: [],
        clientBundleCount: 0,
        durationMs: performance.now() - start,
      });
      const hasChanges = counts.updated > 0 || counts.added.length > 0 || counts.removed.length > 0;
      if (hasChanges) {
        notifyClients();
      }
    });
  }, 100);

  // Build once at startup so entryDeps and knownEntryPatterns are populated
  // before any file-change events arrive.
  reloadChain = reloadChain.then(async () => {
    try {
      const freshRoutes = await buildEntry();
      if (freshRoutes) {
        knownEntryPatterns = new Set(Object.keys(freshRoutes));
      }
    } catch (e) {
      logger.warn(`Initial entry build failed: ${e instanceof Error ? e.message : e}`);
    }
  });

  const finalWatchPaths = watchPaths.filter((p) => existsSync(p));
  const outDirAbs = path.resolve(outDir);
  const isInsideOutDir = (filePath: string): boolean => {
    const abs = path.resolve(filePath);
    return abs === outDirAbs || abs.startsWith(outDirAbs + path.sep);
  };
  const watcher = createWatcher(finalWatchPaths, {
    ignored: [/(^|[/\\])node_modules([/\\]|$)/, isInsideOutDir],
    cwd: process.cwd(),
  });

  const watcherReady =
    finalWatchPaths.length === 0
      ? // The watcher never emits 'ready' for an empty watch set, so don't wait
        // on it — there's nothing being watched, hence no startup race to guard.
        Promise.resolve()
      : new Promise<void>((resolve) => {
          let settled = false;
          const done = () => {
            if (settled) {
              return;
            }
            settled = true;
            resolve();
          };
          watcher.once('ready', done);
          // Safety net so serve() can't hang indefinitely if 'ready' never
          // arrives. unref so it can't keep the process alive. Reaching this
          // means the watcher never signalled ready for a non-empty watch set
          setTimeout(() => {
            if (settled) {
              return;
            }
            logger.error(
              `File watcher never became ready within 10s for ${finalWatchPaths.length} path(s): ${finalWatchPaths.join(', ')}. ` +
                `Live reload may not work — please report this at https://github.com/khromov/mochi/issues`,
            );
            done();
          }, 10000).unref?.();
        });

  const publicDirRel = path.relative(process.cwd(), path.resolve(publicDir));
  // Rebuild from the same helpers the startup path uses, so the encoding and
  // conflict rules can't diverge between the two. The reload always rescans the
  // whole dir, so it doesn't need the changed path — logging happens per-event
  // in the watcher handler below (a rename surfaces as remove-old + add-new).
  let reloadPublic: (() => void) | undefined;
  if (existsSync(publicDir)) {
    reloadPublic = debounce(async () => {
      const freshPublic = await resolvePublicFiles({ publicDir, development });
      const nextRoutes: Record<string, BunRouteValue> = { ...baseBunRoutes };
      registerPublicRoutes(nextRoutes, freshPublic);
      nextRoutes['/__mochi_live_reload'] = liveReloadHandler;
      server.reload({
        routes: nextRoutes,
        fetch: composedFetch,
      } as Parameters<typeof server.reload>[0]);
      notifyClients();
    }, 100);
  }

  watcher
    .on('all', (event, filePath) => {
      if (FILE_CHANGE_EVENTS.has(event)) {
        mochiEvents.emit('file:change', {
          path: path.resolve(filePath),
          type: event as MochiFileChangeType,
        });
      }
      if (event === 'unlink' && filePath.endsWith('.svelte')) {
        evictPreprocessCacheEntry(path.resolve(filePath));
        registry.evict(path.resolve(filePath));
      }
      if (triggerShellReload && shellPath && path.resolve(filePath) === shellPath) {
        triggerShellReload(filePath);
      } else if (reloadPublic && filePath.startsWith(publicDirRel + path.sep)) {
        logger.info(`Public file ${publicChangeVerb(event)}: ${filePath} — reloading routes`);
        reloadPublic();
      } else if (filePath.endsWith('.css')) {
        triggerCssReload(filePath);
      } else if (!filePath.endsWith('.svelte') && entryDeps.has(path.resolve(filePath))) {
        triggerEntryReload(filePath);
      } else {
        triggerReload(filePath);
      }
    })
    .on('error', (err: unknown) => {
      logger.warn(`File watcher error: ${err instanceof Error ? err.message : err}`);
    });

  // Watch svelte.config.js separately so edits during dev pick up without a restart.
  const svelteConfigPath = path.resolve('svelte.config.js');
  const reloadSvelteConfig = debounce(() => {
    reloadChain = reloadChain.then(async () => {
      const pageCount = registry.getPageCount();
      mochiEvents.emit('recompile:start', { trigger: 'svelte-config', path: svelteConfigPath, pageCount });
      const start = performance.now();
      let summary: { pages: Set<string>; clientBundleCount: number } = { pages: new Set(), clientBundleCount: 0 };
      try {
        registry.svelteConfig = await loadSvelteConfig(undefined, { reload: true, tempDir: outDir });
        summary = await registry.recompileAll();
      } catch (e) {
        logger.warn(`Svelte config reload failed: ${e instanceof Error ? e.message : e}`);
      }
      mochiEvents.emit('recompile:complete', {
        trigger: 'svelte-config',
        path: svelteConfigPath,
        pageCount: summary.pages.size,
        pages: [...summary.pages],
        clientBundleCount: summary.clientBundleCount,
        durationMs: performance.now() - start,
      });
      // Full registry rebuild — every tab needs to reload.
      notifyClients();
    });
  }, 100);
  const svelteConfigWatcher = createWatcher([svelteConfigPath]);
  svelteConfigWatcher
    .on('add', reloadSvelteConfig)
    .on('change', reloadSvelteConfig)
    .on('error', (err: unknown) => {
      logger.warn(`Svelte config watcher error: ${err instanceof Error ? err.message : err}`);
    });

  server.reload({
    routes: {
      ...bunRoutes,
      '/__mochi_live_reload': liveReloadHandler,
    },
    fetch: composedFetch,
  } as Parameters<typeof server.reload>[0]);

  return watcherReady;
}
