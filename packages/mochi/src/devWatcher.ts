import type { Server, ServerWebSocket } from 'bun';
import { existsSync } from 'fs';
import path from 'node:path';
import chokidar from 'chokidar';
import debounce from 'debounce';
import type { ComponentRegistry } from './ComponentRegistry';
import { applyFilter } from './extensions';
import { mochiEvents } from './events';
import type { MochiFileChangeType } from './events';
import { logger } from './log';
import { buildPublicUrl } from './proxy';
import { scanPublicDir } from './publicDir';
import { loadSvelteConfig } from './svelteConfig';
import type { BunRouteValue, MochiServeOptions, MochiWsData } from './types';

const FILE_CHANGE_EVENTS = new Set<string>(['add', 'change', 'unlink', 'addDir', 'unlinkDir']);

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
}

/**
 * Wire up the dev-mode file watcher: chokidar over the source tree, public
 * dir, and `svelte.config.js`. Saves are debounced (100 ms) and serialized
 * through a Promise chain so the live-reload signal only fires after client
 * chunks are ready. CSS edits take a fast-path that re-bundles imported CSS
 * without an SSR recompile; public-dir edits rescan and reload the route map.
 */
export function startDevWatcher(deps: DevWatcherDeps): void {
  const { registry, server, options, liveReloadClients, composedFetch, baseBunRoutes, bunRoutes, outDir, publicDir, watchPaths, development } = deps;

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

  const finalWatchPaths = watchPaths.filter((p) => existsSync(p));
  const outDirAbs = path.resolve(outDir);
  const isInsideOutDir = (filePath: string): boolean => {
    const abs = path.resolve(filePath);
    return abs === outDirAbs || abs.startsWith(outDirAbs + path.sep);
  };
  const watcher = chokidar.watch(finalWatchPaths, {
    ignoreInitial: true,
    ignored: [/node_modules\/\.cache/, isInsideOutDir],
    cwd: process.cwd(),
  });

  const publicDirRel = path.relative(process.cwd(), path.resolve(publicDir));
  let reloadPublic: ((filePath: string) => void) | undefined;
  if (existsSync(publicDir)) {
    reloadPublic = debounce(async (filePath: string) => {
      logger.info(`Public file changed: ${filePath} — reloading routes`);
      const rescanned = await scanPublicDir(publicDir);
      const freshPublic = await applyFilter('publicDir:scan', rescanned, {
        publicDir,
        development,
      });
      const nextRoutes: Record<string, BunRouteValue> = { ...baseBunRoutes };
      for (const [urlPath, diskPath] of freshPublic) {
        if (!(urlPath in nextRoutes)) {
          nextRoutes[urlPath] = Bun.file(diskPath);
        } else {
          logger.warn(`Public file "${diskPath}" skipped: URL "${urlPath}" is already registered as a route.`);
        }
      }
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
      if (reloadPublic && filePath.startsWith(publicDirRel + path.sep)) {
        reloadPublic(filePath);
      } else if (filePath.endsWith('.css')) {
        triggerCssReload(filePath);
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
        registry.svelteConfig = await loadSvelteConfig();
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
  const svelteConfigWatcher = chokidar.watch(svelteConfigPath, { ignoreInitial: true });
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
}
