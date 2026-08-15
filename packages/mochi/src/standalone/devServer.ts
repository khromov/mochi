import path from 'node:path';
import fs from 'node:fs';
import type { ServerWebSocket } from 'bun';
import chokidar from 'chokidar';
import debounce from '../vendor/debounce/index';
import type { CompileOptions } from 'svelte/compiler';
import type { MochiStandaloneOptions } from '../types';
import type { SvelteCompilerBackend } from '../compiler/svelteCompilerBackend';
import { buildInlineWebComponent } from '../compiler/buildInlineWebComponent';
import { buildStandaloneClient, type StandaloneClientBuild } from './build';
import { loadStandaloneShell, renderStandaloneHtml } from './standalone';
import { validateStandaloneOptions } from './validate';
import { extractStandaloneOptions } from '../cli/extractServeOptions';
import { liveReloadGreeting, recordReloadSignal } from '../dev/liveReloadGeneration';
import { isExcludedDotPath } from '../runtime/publicDir';
import { logger } from '../utils/log';
import { toPosixPath } from '../utils';

const DEV_BUILD_DIR = path.join('.mochi', 'standalone-dev');
const WATCH_DEBOUNCE_MS = 100;

let devServerBooted = false;

type LiveReloadSocket = ServerWebSocket<{ entry?: string }>;

export interface StandaloneDevServerHandle {
  server: ReturnType<typeof Bun.serve>;
  stop(): Promise<void>;
}

/**
 * The standalone dev loop: an in-memory static server for the built SPA plus chokidar → rebuild → full-page reload.
 * Every non-asset path serves index.html (the app routes on the hash), so deep links work like Capacitor's own server.
 */
export async function startStandaloneDevServer(opts: {
  options: MochiStandaloneOptions;
  entryPath: string;
  backend: SvelteCompilerBackend;
  userCompilerOptions: CompileOptions;
}): Promise<StandaloneDevServerHandle> {
  if (devServerBooted) {
    throw new Error('The standalone dev server has already been started. Only one instance is allowed.');
  }
  devServerBooted = true;

  const { entryPath, backend, userCompilerOptions } = opts;
  let options = opts.options;
  const publicDir = path.resolve(options.publicDir ?? './public');
  const shellPath = options.htmlShell?.endsWith('.html') ? path.resolve(options.htmlShell) : undefined;
  const buildDir = path.resolve(DEV_BUILD_DIR);
  const liveReloadClientJs = await buildInlineWebComponent('./web-components/LiveReload.ts');

  let state: { build: StandaloneClientBuild; html: string };

  async function rebuild(): Promise<void> {
    fs.rmSync(buildDir, { recursive: true, force: true });
    fs.mkdirSync(buildDir, { recursive: true });
    const build = await buildStandaloneClient({
      entryPath,
      routes: options.routes,
      notFound: options.notFound,
      loading: options.loading,
      development: true,
      outDir: buildDir,
      backend,
      userCompilerOptions,
    });
    const template = await loadStandaloneShell(options);
    state = { build, html: renderStandaloneHtml({ template, build, logLevel: options.logger?.level, liveReloadClientJs }) };
  }

  await rebuild();

  const clients = new Set<LiveReloadSocket>();

  function publicFilePath(pathname: string): string | null {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    const resolved = path.normalize(path.join(publicDir, decoded));
    if (resolved !== publicDir && !resolved.startsWith(publicDir + path.sep)) {
      return null;
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return null;
    }
    if (isExcludedDotPath(toPosixPath(path.relative(publicDir, resolved)))) {
      return null;
    }
    return resolved;
  }

  const server = Bun.serve({
    port: options.port ?? 3000,
    hostname: options.hostname,
    websocket: {
      open(ws: LiveReloadSocket) {
        clients.add(ws);
        ws.send(liveReloadGreeting(ws.data.entry));
      },
      message(ws: LiveReloadSocket, message: string | Buffer) {
        if (message === 'ping') {
          ws.send('pong');
        }
      },
      close(ws: LiveReloadSocket) {
        clients.delete(ws);
      },
    },
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === '/__mochi_live_reload') {
        if (srv.upgrade(req, { data: { entry: url.searchParams.get('entry') ?? undefined } })) {
          return undefined;
        }
        return new Response('Upgrade failed', { status: 400 });
      }
      const buildFile = state.build.files.get(url.pathname.slice(1));
      if (buildFile) {
        return new Response(Bun.file(buildFile), { headers: { 'Cache-Control': 'no-store' } });
      }
      const publicFile = publicFilePath(url.pathname);
      if (publicFile) {
        return new Response(Bun.file(publicFile), { headers: { 'Cache-Control': 'no-store' } });
      }
      return new Response(state.html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    },
  });

  const triggerReload = debounce((filename: string) => {
    void (async () => {
      try {
        const extracted = await extractStandaloneOptions(entryPath, { fresh: true });
        if (extracted) {
          validateStandaloneOptions(extracted as MochiStandaloneOptions);
          options = extracted as MochiStandaloneOptions;
        } else {
          logger.warn('[mochi] The entry no longer calls Mochi.standalone() — keeping the previous route table.');
        }
        await rebuild();
        recordReloadSignal();
        for (const ws of clients) {
          ws.send('reload');
        }
        logger.info(`Reloaded after change: ${toPosixPath(filename)}`);
      } catch (err) {
        // A broken edit keeps the previous build serving; the next successful rebuild picks up from here.
        logger.error(`[mochi] Standalone rebuild failed:`, err);
      }
    })();
  }, WATCH_DEBOUNCE_MS);

  const watchPaths = [path.dirname(entryPath), ...(fs.existsSync(publicDir) ? [publicDir] : []), ...(shellPath ? [shellPath] : []), ...(options.additionalWatchPaths ?? [])];
  const watcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    ignored: (watched: string) => /(?:^|[\\/])(?:node_modules|\.git|\.mochi|dist)(?:[\\/]|$)/.test(watched),
  });
  watcher.on('all', (_event, filename) => {
    triggerReload(filename);
  });

  const url = `http://${server.hostname === '0.0.0.0' ? 'localhost' : server.hostname}:${server.port}`;
  logger.info(`Standalone dev server running at ${url} (live reload on)`);

  return {
    server,
    async stop() {
      await watcher.close();
      server.stop(true);
      devServerBooted = false;
    },
  };
}
