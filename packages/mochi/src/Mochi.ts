import type { Server, ServerWebSocket } from 'bun';
import { checkEnvironment } from './cli/checkEnvironment';
import { existsSync, rmSync, mkdirSync } from 'fs';
import path from 'node:path';
import { ComponentRegistry, formatCompileErrors } from './compiler/ComponentRegistry';
import type { RenderResult } from './compiler/ComponentRegistry';
import { loadSvelteConfig } from './compiler/svelteConfig';
import { buildInlineWebComponent } from './compiler/buildInlineWebComponent';
import { buildClientStatsRoutes, CLIENT_STATS_COMPONENT } from './dev/clientStatsRoutes';
import { buildEmailViewerRoutes, EMAIL_VIEWER_COMPONENT } from './dev/emailViewerRoutes';
import { isMochiPage, isMochiApi, isMochiWs, isMochiSse, isMochiFile, isMochiQueue, isServerPropsResolver, isAlsoHydrateMode, ALSO_HYDRATE_ENVELOPE_KEY } from './types';
import { HYDRATABLE_CONTEXT_KEY } from './islands/isHydratable';
import type {
  BunRouteValue,
  HttpMethod,
  MochiApiConfig,
  MochiApiHandler,
  MochiFileConfig,
  MochiFileResolver,
  MochiPageConfig,
  MochiPageHandlerConfig,
  MochiFormActionResult,
  MochiFormActions,
  MochiRouteValue,
  MochiServerPropsResolver,
  MochiServeOptions,
  MochiQueueConfig,
  RouteRegistrationResult,
  MochiSseConfig,
  MochiSseHandler,
  MochiSseStream,
  MochiWsConfig,
  MochiWsHandlers,
  MochiWsData,
  MochiWsOriginOptions,
} from './types';
import { isFormFail, isFormRedirect, isFormSuccess } from './runtime/forms';
import { isEnhanceRequest, jsonError, jsonFailure, jsonRedirect, jsonSuccess } from './runtime/formsJson';
import { DEFAULT_FORM_CONTENT_TYPES, DEFAULT_PROTECTED_METHODS } from './runtime/csrf';
import { applyFilter, initExtensions, runHook } from './extensions';
import { escapeHtmlAttr } from './utils/htmlEscape';
import { normalizeHttpOrigin, validateProxyOptions } from './runtime/proxy';
import { realpath } from 'node:fs/promises';
import { apiError, collectHeaderPairs, cssLinkTag, headResponse, isHtmlResponse, MochiHttpError, toPosixPath, withHead } from './utils';
import type { MochiEvent, MochiResolveOptions } from './runtime/hooks';
import { applyResolveOptions } from './runtime/hooks';
import { alternateSlashPattern, trailingSlashRedirect } from './runtime/trailingSlash';
import { resolveWarmupEnabled, markWarmupRequest, isWarmablePattern } from './runtime/warmup';
import { createErrorResponder, DEFAULT_ERROR_PAGE_PATH } from './runtime/errors';
import { requestContext } from './runtime/requestContext';
import type { MochiRequestContext } from './runtime/requestContext';
import { createQueue, getQueue, closeAllQueueResources, runQueueRecovery } from './queue';
import { resetStartupMilestones } from './lifecycle';
import type { MochiQueue, MochiQueueOptions, MochiQueueListeners, MochiProcessor } from './queue';
import { finalizeCookieHeaders } from './runtime/cookies';
import { makeRequestContextBuilder } from './runtime/requestSetup';
import { createRouteLimiter, applyRateLimitHeaders } from './runtime/rateLimit';
import type { MochiRateLimitOptions, MochiRateLimitStore, RouteLimiter } from './runtime/rateLimit';
import { decryptProps } from './islands/serverIslandCrypto';
import { createImageHandler } from './image/imageEndpoint';
import { createLocalAssetHandler } from './image/localAssetRegistry';
import { getImageRuntime } from './image/config';
import { startImageCacheSweeper } from './image/sweeper';
import { getEmailRuntime, closeEmailTransport } from './email/config';
import { onDevEmailRecorded } from './email/devOutbox';
import { sendEmail } from './email/mailer';
import type { MochiEmailMessage, MochiEmailResult } from './email/types';
import { initMochiConfig } from './mochiConfig';
import { logger, setLogLevel, DEFAULT_LOG_LEVEL, type LogLevel } from './utils/log';
import { mochiEvents } from './events';
import type { MochiActionResult, MochiErrorEvent, MochiErrorKind, MochiServerStartEvent, MochiServerStopEvent } from './events';
import type { DebugBarData, DebugBarRuntimeData } from './runtime/requestContext';
import { consoleLogger } from './dev/consoleLogger';
import { parse as devalueParse, stringify as devalueStringify } from 'devalue';
import { ISLAND_FAILURE_CSS, ISLAND_FAILURE_DEV_CSS, islandFailureStub } from './web-components/islandFailureStub';
import { resolvePublicFiles, registerPublicRoutes, isExcludedDotPath } from './runtime/publicDir';
import { startDevWatcher } from './dev/devWatcher';
import { buildPageCacheAdminRoutes, PAGE_CACHE_ADMIN_COMPONENT } from './dev/pageCacheAdminRoutes';
import { liveReloadGreeting } from './dev/liveReloadGeneration';
import { resolveWsTrustedOrigins, wsOriginCheck } from './runtime/wsOrigin';

const DEFAULT_HTML_SHELL = await Bun.file(new URL('./templates/default-shell.html', import.meta.url)).text();

let mochiVersionPromise: Promise<string | null> | undefined;
function readMochiVersion(): Promise<string | null> {
  return (mochiVersionPromise ??= Bun.file(path.join(import.meta.dir, '..', 'package.json'))
    .json()
    .then((pkg) => (pkg as { version: string }).version)
    .catch(() => null));
}

type ShellSlot = 'head' | 'css' | 'body' | 'script';
type ShellPart = { text: string } | { slot: ShellSlot };

// Parse an HTML shell into ordered literal/placeholder parts ONCE (per template),
// so filling it per request is a walk over these parts instead of a global-regex
// scan. Splitting the template (not the assembled output) also guarantees an
// injected body containing literal `{{mochi.script}}` is never re-expanded.
function parseShellTemplate(template: string): ShellPart[] {
  const parts: ShellPart[] = [];
  const re = /\{\{mochi\.(head|css|body|script)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (m.index > last) {
      parts.push({ text: template.slice(last, m.index) });
    }
    parts.push({ slot: m[1] as ShellSlot });
    last = m.index + m[0].length;
  }
  if (last < template.length) {
    parts.push({ text: template.slice(last) });
  }
  return parts;
}

/**
 * Dev-only: append a trailing `<script>` after the response body that mixes
 * the current request's response headers and inbound cookies into
 * `window.__mochi_debug`. The static fields (route, params, …)
 * are baked into the body in `createShellRenderer` and cached with it; the
 * dynamic fields written here always reflect *this* request, so cache hits
 * still see the correct headers and cookies.
 *
 * The trailing script runs synchronously during HTML parse, before the
 * deferred debug-bar `<script type="module">` executes — `onMount` reads a
 * fully-populated payload, no polling needed.
 *
 * Skipped when the body is already compressed (a user opted into gzip in
 * dev) since we can't safely insert text into encoded bytes.
 */
function jsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function redactDebugHeader([name, value]: [string, string]): [string, string] {
  if (name.toLowerCase() !== 'set-cookie') {
    return [name, value];
  }
  const semi = value.indexOf(';');
  const first = semi === -1 ? value : value.slice(0, semi);
  const eq = first.indexOf('=');
  const cookieName = (eq === -1 ? first : first.slice(0, eq)).trim();
  const attributes = semi === -1 ? '' : value.slice(semi);
  return [name, `${cookieName}=<redacted>${attributes}`];
}

async function appendDebugTail(response: Response, ctx: MochiRequestContext, development: boolean): Promise<Response> {
  if (!development) {
    return response;
  }
  if (response.headers.get('Content-Encoding')) {
    return response;
  }
  if (!ctx.debugBarData || !isHtmlResponse(response)) {
    return response;
  }
  const dynamic: Pick<DebugBarRuntimeData, 'headers' | 'requestCookies'> = {
    headers: collectHeaderPairs(response.headers).map(redactDebugHeader),
    requestCookies: ctx.cookies.peekAll().map(({ name }) => name),
  };
  const body = await response.text();
  const tail = `<script>Object.assign((window.__mochi_debug||={}),${jsonForHtml(dynamic)})</script>`;
  return new Response(body + tail, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export class Mochi {
  static page(
    componentPath: string,
    config?: {
      serverProps?: Record<string, unknown> | MochiServerPropsResolver;
      actions?: MochiFormActions;
      rateLimit?: MochiRateLimitOptions | false;
    },
  ): MochiPageConfig {
    return {
      __mochiPage: true,
      componentPath,
      serverProps: config?.serverProps,
      actions: config?.actions,
      rateLimit: config?.rateLimit,
    };
  }

  static api(handler: MochiApiHandler, config?: { rateLimit?: MochiRateLimitOptions | false }): MochiApiConfig {
    return { __mochiApi: true, handler, rateLimit: config?.rateLimit };
  }

  static ws<T = unknown>(handlers: MochiWsHandlers<T>, origin: MochiWsOriginOptions = {}): MochiWsConfig {
    return {
      __mochiWs: true,
      handlers: handlers as MochiWsHandlers<unknown>,
      origin,
    };
  }

  static sse(handler: MochiSseHandler): MochiSseConfig {
    return { __mochiSse: true, handler };
  }

  static file(source: string | MochiFileResolver): MochiFileConfig {
    return { __mochiFile: true, source };
  }

  /**
   * Declare a background job queue. Like `page`/`api`/`ws`/`sse`/`file`, this
   * returns an *inert config* — the live queue (producer + consumer) is created
   * only when the descriptor is mounted in `Mochi.serve({ queues })`, keyed by
   * queue name. The config bundles the `process` consumer (receives a read-only
   * `MochiJob`, returns the job result) with its options (`concurrency`,
   * `dataPath`, …) and optional `on` lifecycle listeners. Add jobs from
   * anywhere via `Mochi.getQueue(name).add(...)`. Queues drain gracefully on
   * `Mochi.serve()` shutdown.
   */
  static queue<T = unknown, R = unknown>(config: MochiQueueOptions<T, R>): MochiQueueConfig {
    // `recover` is destructured out for the same reason as `process`/`on`:
    // whatever is left in `options` is forwarded verbatim to bunqueue.
    const { process, on, recover, ...options } = config;
    return {
      __mochiQueue: true,
      process: process as MochiProcessor<unknown, unknown>,
      options,
      on: on as Partial<MochiQueueListeners<unknown, unknown>> | undefined,
      recover: recover as ((queue: MochiQueue<never>) => void | Promise<void>) | undefined,
    };
  }

  /**
   * Resolve the handle for a queue declared in
   * `Mochi.serve({ queues })` and `.add()` jobs to it. Pass the payload type
   * explicitly (`Mochi.getQueue<JobData>(name)`). Throws if the queue name was
   * never declared, or if reached before `Mochi.serve()` has mounted its queues.
   */
  static getQueue<T = unknown>(name: string): MochiQueue<T> {
    return getQueue<T>(name);
  }

  /**
   * Send a transactional email. Configured under `Mochi.serve({ email })` with
   * a default `from` and a pluggable `transport` (SMTP, a custom-send function,
   * or the default `log` transport that logs instead of sending). Pass a
   * message body as `html`, `text`, or a Svelte `component` (rendered to HTML
   * with its scoped CSS inlined). Callable from any server-side code — route
   * actions, API handlers, or queue jobs.
   */
  static email(message: MochiEmailMessage): Promise<MochiEmailResult> {
    return sendEmail(message);
  }

  /**
   * Build a shell renderer once at startup. Request-invariant fragments (the log
   * shim, warn shim, island `<style>` prefix, server-island runtime wrapper,
   * live-reload tail, asset prefix) are computed here, so filling the shell per
   * request only concatenates the genuinely dynamic parts into the pre-parsed
   * template segments — no per-request regex scan or constant-string rebuilds.
   */
  private static createShellRenderer(
    registry: ComponentRegistry,
    config: {
      serverIslandClientJs: string;
      liveReloadClientJs: string;
      logLevel: LogLevel;
      /** Reads the current shell template (reassigned on dev shell edits). */
      getTemplate: () => string;
    },
  ): (result: RenderResult, opts?: { debugInfo?: DebugBarData; pageEntry?: string }) => string {
    const { serverIslandClientJs, liveReloadClientJs, logLevel, getTemplate } = config;

    const logLevelScript = logLevel === DEFAULT_LOG_LEVEL ? '' : `<script>window.__mochi_log_level=${JSON.stringify(logLevel)}</script>`;
    // Feeds the debug bar's Warnings panel. When the debug bar is off the
    // single `window.__mochi_warn?.(...)` call site no-ops via optional chaining.
    const warnShim = registry.debugBarEnabled
      ? `<script>window.__mochi_warnings=[];window.__mochi_warn=function(m){console.warn("[mochi] "+m);window.__mochi_warnings.push(m)}</script>`
      : '';
    const cssStylePrefix = `<style>mochi-hydratable-island, mochi-server-island { display: contents; } mochi-server-island[defer-on="visible"]:empty, mochi-hydratable-island[hydrate-on="visible"]:empty { display: block; min-height: 1px; }${ISLAND_FAILURE_CSS}${
      registry.development ? ISLAND_FAILURE_DEV_CSS : ''
    }</style>\n`;
    const serverIslandScript = `<script>(()=>{${serverIslandClientJs}})()</script>`;
    const liveReloadTail = liveReloadClientJs ? `<script>${liveReloadClientJs}</script><mochi-live-reload></mochi-live-reload>` : '';
    const toolbarDiv = registry.debugBarEnabled ? '<div id="mochi-dev-toolbar"></div>' : '';
    const assetPrefixJson = JSON.stringify(registry.assetPrefix);

    // Parse the shell once; re-parse only when a dev shell edit swaps the template.
    let parsedFrom: string | undefined;
    let parts: ShellPart[] = [];

    return (result, opts) => {
      const template = getTemplate();
      if (template !== parsedFrom) {
        parts = parseShellTemplate(template);
        parsedFrom = template;
      }

      const bootstrapUrl = result.bootstrapUrl;
      const cssLinks = result.cssUrls.map(cssLinkTag).join('\n');
      const debugBarUrl = registry.getDebugBarUrl();
      const debugInfoScript = registry.debugBarEnabled && opts?.debugInfo ? `<script>window.__mochi_debug=${jsonForHtml(opts.debugInfo)}</script>` : '';
      const pageEntryScript = liveReloadClientJs && opts?.pageEntry ? `<script>window.__mochi_page_entry=${jsonForHtml(opts.pageEntry)}</script>` : '';

      const head = logLevelScript + warnShim + result.head;
      const css = cssStylePrefix + cssLinks;
      const body = result.body + debugInfoScript + pageEntryScript + toolbarDiv;
      const script =
        (bootstrapUrl ? `<script type="module" src="${bootstrapUrl}"></script>` : '') +
        (result.hasServerIslands ? serverIslandScript : '') +
        (debugBarUrl ? `<script type="module" src="${debugBarUrl}"></script><script>window.__mochi_asset_prefix=${assetPrefixJson}</script>` : '') +
        liveReloadTail;

      let out = '';
      for (const part of parts) {
        if ('text' in part) {
          out += part.text;
        } else {
          out += part.slot === 'head' ? head : part.slot === 'css' ? css : part.slot === 'body' ? body : script;
        }
      }
      return out;
    };
  }

  static async serve(options: MochiServeOptions): Promise<Server<undefined>> {
    validateProxyOptions(options.proxy);
    const { svelteVersion } = await checkEnvironment();
    const mochiVersion = await readMochiVersion();
    initExtensions(options);
    await runHook('mochi:init', { options });
    await initMochiConfig(options);

    // Resolve filterable defaults once at startup; the resolved Sets are
    // captured in the per-request closures below. A fresh copy of each
    // default Set is passed to the user so accidental in-place mutation
    // can't poison the framework default for the next call.
    const formContentTypes: ReadonlySet<string> = applyFilter('csrf:formContentTypes', new Set(DEFAULT_FORM_CONTENT_TYPES), { options });
    const protectedMethods: ReadonlySet<string> = applyFilter('csrf:protectedMethods', new Set(DEFAULT_PROTECTED_METHODS), { options });
    const filteredTrustedOrigins: ReadonlySet<string> = applyFilter('csrf:trustedOrigins', new Set(options.csrf?.trustedOrigins ?? []), { options });
    const trustedOrigins: ReadonlySet<string> = new Set([...filteredTrustedOrigins].map((origin) => normalizeHttpOrigin(origin, 'Mochi.serve({ csrf.trustedOrigins })')));
    const cookieDefaults = applyFilter('cookie:defaults', {}, { options });

    const development = options.development ?? true;
    const warmupEnabled = resolveWarmupEnabled(options.warmup, development);
    const debugBarEnabled = development && (options.debugBar ?? true);
    const liveReloadEnabled = options.liveReload ?? development;
    const middleware = options.handle;
    const baseOutDir = options.outDir ?? './.mochi';
    // Keep dev artifacts out of the production .mochi so the two modes never
    // collide (stale manifest/public from a prod build, or dev chunks served by
    // a later `start`). Prod stays at the root so Docker/deploys are unaffected.
    const outDir = development ? path.join(baseOutDir, 'dev') : baseOutDir;
    const publicDir = options.publicDir ?? './public';
    // Only a file-based shell can be watched/re-read; an inline-string shell
    // has no source file, and the built-in default is bundled, not a runtime file.
    const shellPath = options.htmlShell?.endsWith('.html') ? path.resolve(options.htmlShell) : undefined;
    const watchPaths = Array.from(new Set(['src', 'public', ...(shellPath ? [shellPath] : []), ...(options.additionalWatchPaths ?? [])]));

    const emitError = (kind: MochiErrorKind, requestId: string, req: Request, url: URL, status: number, err: unknown, actionName?: string): void => {
      const message = err instanceof Error ? err.message : err == null ? 'Unknown error' : String(err);
      const payload: MochiErrorEvent = {
        requestId,
        kind,
        path: url.pathname + url.search,
        method: req.method,
        status,
        message,
      };
      if (development && err instanceof Error && typeof err.stack === 'string') {
        payload.stack = err.stack;
      }
      if (actionName !== undefined) {
        payload.actionName = actionName;
      }
      mochiEvents.emit('error', payload);
    };

    const requestIdHeader = options.proxy?.requestIdHeader;
    const newRequestId = (req: Request): string => {
      if (requestIdHeader) {
        const inbound = req.headers.get(requestIdHeader)?.trim();
        if (inbound) {
          return inbound;
        }
      }
      return Bun.randomUUIDv7();
    };

    const { enabled: loggerEnabled = true, level: configuredLevel, ...loggerOptions } = options.logger ?? {};
    const resolvedLogLevel: LogLevel = configuredLevel ?? (development ? 'info' : DEFAULT_LOG_LEVEL);
    setLogLevel(resolvedLogLevel);

    if (loggerEnabled) {
      consoleLogger(loggerOptions);
    }

    logger.info(`Starting in ${development ? 'development' : 'production'} mode`);
    if (
      development &&
      options.hostname !== undefined &&
      !new Set(['localhost', '127.0.0.1', '::1', '[::1]']).has(options.hostname.toLowerCase()) &&
      (debugBarEnabled || liveReloadEnabled || getEmailRuntime().options.transport.type === 'dev')
    ) {
      logger.warn(
        `Development tooling is listening on non-loopback hostname ${JSON.stringify(options.hostname)}. ` +
          `The debug bar, live reload, and dev email viewer are not a production security boundary; expose this server only on a trusted network.`,
      );
    }

    // In production, load prebuilt assets from manifest if available
    const manifestPath = options.manifest ?? `${outDir}/manifest.json`;
    let registry: ComponentRegistry;
    if (!development && existsSync(manifestPath)) {
      logger.info(`Loading prebuilt manifest from ${manifestPath}`);
      registry = await ComponentRegistry.fromManifest(manifestPath, development, outDir);
      if (options.assetPrefix !== undefined && options.assetPrefix !== registry.assetPrefix) {
        logger.warn(
          `assetPrefix in Mochi.serve() (${JSON.stringify(options.assetPrefix)}) differs from the manifest (${JSON.stringify(registry.assetPrefix)}). Using the manifest value — URLs are baked in at build time.`,
        );
      }
    } else {
      const svelteConfig = await loadSvelteConfig(options.svelteConfigPath);
      registry = new ComponentRegistry({
        development,
        debugBar: options.debugBar,
        outDir,
        assetPrefix: options.assetPrefix,
        svelteConfig,
        svelteCompiler: options.svelteCompiler,
        markdown: options.markdown,
        optimize: options.optimize,
        barrelWarnings: options.barrelWarnings,
      });
      // No-op in dev or when the option is off; production-without-manifest
      // compiles at startup, so the shake must run before the first compile.
      await registry.prepareShake();
      if (development) {
        // outDir is the dev-only dir (.mochi/dev). Wipe it whole each startup so
        // stale entry-hmr / import-css / compiled chunks can't leak across restarts.
        rmSync(outDir, { recursive: true, force: true });
        for (const sub of ['svelte-client', 'svelte-compile', 'svelte-css']) {
          mkdirSync(path.join(outDir, sub), { recursive: true });
        }
      } else {
        // Production without a prebuilt manifest is valid but silently much
        // slower — components compile at boot and server islands compile on the
        // request path. Warn loudly (error level) so a forgotten build doesn't
        // masquerade as a healthy deploy.
        logger.error(
          `Running in production without a prebuilt manifest (${manifestPath} not found). ` +
            `This is an unsupported configuration and is not recommended: components compile at startup ` +
            `and server islands compile on the first request, making cold starts and initial responses ` +
            `much slower. Run \`mochi-framework build\` before \`start\` to precompile and bake the manifest.`,
        );
      }
    }

    const emailTransportType = getEmailRuntime().options.transport.type;
    // The dev outbox captures mail purely off the resolved transport, independent
    // of the debug bar — so the viewer route (and its compile) must key off the
    // same condition, or `debugBar: false` silently captures mail with no way to
    // ever read it back (only production is documented to disable the route).
    const emailViewerEnabled = development && emailTransportType === 'dev';

    const serverDebugInfo: Partial<DebugBarData> = {
      mochiVersion: mochiVersion ?? undefined,
      svelteVersion,
      bunVersion: Bun.version,
      config: {
        mode: development ? 'development' : 'production',
        port: options.port,
        hostname: options.hostname,
        debugBar: debugBarEnabled,
        liveReload: liveReloadEnabled,
        warmup: warmupEnabled,
        compressServerIslandProps: options.compressServerIslandProps ?? false,
        trailingSlash: options.trailingSlash ?? 'never',
        assetPrefix: registry.assetPrefix || undefined,
        logLevel: resolvedLogLevel,
        middleware: !!middleware,
        csrf: !!options.csrf,
        proxy: !!options.proxy,
        markdown: !!options.markdown,
        email: emailTransportType,
        routeCount: Object.keys(options.routes ?? {}).length,
      },
    };

    let shellTemplate: string;
    if (options.htmlShell) {
      shellTemplate = shellPath ? await Bun.file(shellPath).text() : options.htmlShell;
    } else {
      shellTemplate = DEFAULT_HTML_SHELL;
    }
    shellTemplate = applyFilter('html:shell', shellTemplate, { options, development });

    // Re-read the shell on change so dev edits to styling/head/scripts take
    // effect. Both render closures below capture `shellTemplate` by reference,
    // so reassigning it is picked up on the next request.
    const reloadShell = shellPath
      ? async () => {
          shellTemplate = applyFilter('html:shell', await Bun.file(shellPath).text(), { options, development });
        }
      : undefined;

    const errorPagePath = options.errorPage ?? DEFAULT_ERROR_PAGE_PATH;

    // Collect every page entrypoint (error page + every Mochi.page route) so
    // we can compile them in one Bun.build below. Splitting deduplicates
    // shared transitive deps (devalue, mochi-framework internals, etc.) into
    // chunk files instead of inlining them per page.
    const ssrEntrypoints: string[] = [errorPagePath, CLIENT_STATS_COMPONENT];
    if (debugBarEnabled) {
      ssrEntrypoints.push(PAGE_CACHE_ADMIN_COMPONENT);
    }
    if (emailViewerEnabled) {
      ssrEntrypoints.push(EMAIL_VIEWER_COMPONENT);
    }
    if (options.routes) {
      for (const handler of Object.values(options.routes)) {
        if (isMochiPage(handler)) {
          if (existsSync(handler.componentPath)) {
            ssrEntrypoints.push(handler.componentPath);
          } else if (development) {
            logger.warn(`Route component not found: ${handler.componentPath} — will compile when created`);
          }
        }
      }
    }
    await registry.compileAll(ssrEntrypoints);

    // Prod-with-manifest restores this from disk (baked by `build()`); otherwise
    // build it on demand. LiveReload is dev-only, so it's never prebuilt.
    const serverIslandClientJs = registry.serverIslandClientJs ?? (await buildInlineWebComponent('./web-components/ServerIsland.ts'));
    const liveReloadClientJs = liveReloadEnabled ? await buildInlineWebComponent('./web-components/LiveReload.ts') : '';

    // Precompute request-invariant shell fragments once; `getTemplate` reads the
    // live `shellTemplate` so dev shell edits (reloadShell) are picked up.
    const renderShell = Mochi.createShellRenderer(registry, {
      serverIslandClientJs,
      liveReloadClientJs,
      logLevel: resolvedLogLevel,
      getTemplate: () => shellTemplate,
    });

    const { renderErrorResponse, routeErrorResponse } = createErrorResponder({
      handleError: options.handleError,
      development,
      registry,
      errorPagePath,
      renderShell: (result) => renderShell(result),
    });

    // Run the user's handleError hook (if configured), sanitize the error for
    // the enhanced JSON path, and return a jsonError envelope. Mirrors the
    // handleError logic in renderErrorResponse but skips the HTML render.
    const handleEnhancedError = async (err: unknown, event: MochiEvent): Promise<Response> => {
      let status = err instanceof MochiHttpError ? err.status : 500;
      let message = err instanceof MochiHttpError ? err.message : development && err instanceof Error ? err.message : 'Internal Server Error';
      if (options.handleError) {
        try {
          const override = await options.handleError({ error: err, event, status, message });
          if (override instanceof Response) {
            return override;
          }
          if (override && typeof override === 'object') {
            if (typeof (override as { status?: unknown }).status === 'number' && typeof (override as { message?: unknown }).message === 'string') {
              status = (override as { status: number }).status;
              message = (override as { message: string }).message;
            } else {
              logger.error('handleError returned invalid override; expected { status: number, message: string } or a Response, got:', override);
            }
          }
        } catch (hookErr) {
          logger.error('handleError hook threw:', hookErr);
        }
      }
      return jsonError(status, message);
    };

    // Pre-compile Mochi.page() handlers so SSR is ready at startup
    const mochiPageMap = new Map<string, MochiPageConfig>();
    const warmupHandlers: { pattern: string; handler: (req: Request, server: Server<undefined>) => Promise<Response> }[] = [];
    const wsHandlersMap = new Map<string, MochiWsHandlers<unknown>>();
    const apiHandlerMap = development ? new Map<string, MochiApiHandler>() : undefined;
    const sseHandlerMap = development ? new Map<string, MochiSseHandler>() : undefined;
    const pageConfigMap = development ? new Map<string, MochiPageHandlerConfig>() : undefined;
    const bunRoutes: Record<string, BunRouteValue> = {};
    const routeCounts = { page: 0, api: 0, ws: 0, sse: 0, file: 0 };
    const trailingSlashPolicy = options.trailingSlash;

    const buildRequestContext = makeRequestContextBuilder({
      proxy: options.proxy,
      csrf: options.csrf,
      trailingSlashPolicy,
      cookieDefaults,
      development,
      debugBarEnabled,
      formContentTypes,
      protectedMethods,
      trustedOrigins,
      newRequestId,
    });

    type SimpleMiddlewareKind = 'image' | 'asset' | 'raw' | 'dev' | 'fallback' | 'error';
    const runSimpleRequest = async (
      req: Request,
      server: Server<undefined>,
      kind: SimpleMiddlewareKind,
      pattern: string,
      inner: (event: MochiEvent, resolveOpts?: MochiResolveOptions) => Response | Promise<Response>,
    ): Promise<Response> => {
      const setup = buildRequestContext(req, server, { kind, pattern, deferGuards: true });
      if ('earlyResponse' in setup) {
        return setup.earlyResponse;
      }
      const { ctx, start, requestId, url, guardResponse } = setup;
      return requestContext.run(ctx, async () => {
        const event: MochiEvent = { request: req, url, server, locals: ctx.locals, kind, isWarmup: ctx.isWarmup };
        const resolve = async (resolvedEvent: MochiEvent, resolveOpts?: MochiResolveOptions): Promise<Response> => guardResponse ?? inner(resolvedEvent, resolveOpts);
        const response = middleware ? await middleware({ event, resolve }) : await resolve(event);
        const final = finalizeCookieHeaders(response, ctx.cookies);
        mochiEvents.emit('request', {
          requestId,
          kind,
          method: req.method,
          path: url.pathname + url.search,
          status: final.status,
          duration: performance.now() - start,
        });
        return final;
      });
    };

    const wrapRawRouteValue = (pattern: string, value: BunRouteValue, kind: SimpleMiddlewareKind = 'raw'): BunRouteValue => {
      const wrapHandler = (
        handler: (req: Request, server: Server<undefined>) => Response | Promise<Response>,
      ): ((req: Request, server: Server<undefined>) => Promise<Response>) => {
        return (req, server) => runSimpleRequest(req, server, kind, pattern, async (event, resolveOpts) => applyResolveOptions(await handler(event.request, server), resolveOpts));
      };

      if (typeof value === 'function') {
        return wrapHandler(value);
      }
      if (value instanceof Response) {
        return wrapHandler(() => value.clone());
      }
      if (value instanceof Blob) {
        return wrapHandler((req) => {
          if (req.method !== 'HEAD') {
            return new Response(value);
          }
          const headers = new Headers({ 'Content-Length': String(value.size) });
          if (value.type) {
            headers.set('Content-Type', value.type);
          }
          return new Response(null, { headers });
        });
      }
      const methods: Record<string, (req: Request, server: Server<undefined>) => Promise<Response>> = {};
      for (const [method, handler] of Object.entries(value)) {
        methods[method] = wrapHandler(handler);
      }
      return methods;
    };

    const runDevWebSocketUpgrade = async (
      req: Request,
      server: Server<undefined>,
      inner: (req: Request, server: Server<undefined>) => Response | undefined,
    ): Promise<Response | undefined> => {
      const pattern = '/__mochi_live_reload';
      const setup = buildRequestContext(req, server, { kind: 'dev', pattern });
      if ('earlyResponse' in setup) {
        return setup.earlyResponse;
      }
      const { ctx, start, requestId, url } = setup;
      return requestContext.run(ctx, async () => {
        const event: MochiEvent = { request: req, url, server, locals: ctx.locals, kind: 'dev', isWarmup: false };
        const sentinel = new Response(null, { status: 204 });
        let resolvedEvent = event;
        const resolve = async (nextEvent: MochiEvent): Promise<Response> => {
          resolvedEvent = nextEvent;
          return sentinel;
        };
        const response = middleware ? await middleware({ event, resolve }) : await resolve(event);
        if (response !== sentinel) {
          const final = finalizeCookieHeaders(response, ctx.cookies);
          mochiEvents.emit('request', {
            requestId,
            kind: 'dev',
            method: req.method,
            path: url.pathname + url.search,
            status: final.status,
            duration: performance.now() - start,
          });
          return final;
        }
        const originResponse = wsOriginCheck(resolvedEvent.request, resolvedEvent.url, {}, new Set());
        if (originResponse) {
          mochiEvents.emit('request', {
            requestId,
            kind: 'dev',
            method: req.method,
            path: url.pathname + url.search,
            status: originResponse.status,
            duration: performance.now() - start,
          });
          return originResponse;
        }
        const result = inner(resolvedEvent.request, server);
        mochiEvents.emit('request', {
          requestId,
          kind: 'dev',
          method: req.method,
          path: url.pathname + url.search,
          status: result ? result.status : 101,
          duration: performance.now() - start,
        });
        return result;
      });
    };

    const internalRoutes: Record<string, MochiPageConfig | MochiApiConfig> = {
      // Gate the client-stats page behind the debug bar (like the page-cache admin
      // routes) — in production it would otherwise disclose every bundle's input
      // file paths and sizes (project structure, dependency names).
      ...(debugBarEnabled ? buildClientStatsRoutes(registry) : {}),
      ...(debugBarEnabled ? buildPageCacheAdminRoutes() : {}),
      ...(emailViewerEnabled ? buildEmailViewerRoutes(registry) : {}),
    };
    const allRoutes = Object.keys(internalRoutes).length > 0 ? { ...internalRoutes, ...(options.routes ?? {}) } : options.routes;

    const rateLimitStores = new Set<MochiRateLimitStore>();
    // Route closures look their limiter up here per request (never capture it) so
    // the dev watcher can swap a route's limiter in place when its `rateLimit`
    // config changes — a captured const would pin the boot-time config until
    // restart. A null entry marks a limitable route with no limiter.
    const routeLimiters = new Map<string, RouteLimiter | null>();
    let sharedGlobalLimiter: RouteLimiter | null = null;
    function buildLimiter(routeCfg: MochiRateLimitOptions | false | undefined, pattern: string): RouteLimiter | null {
      if (routeCfg === false) {
        return null;
      }
      if (routeCfg) {
        // A route's own config is auto-namespaced by its pattern so two routes
        // sharing a persisted store don't drain one bucket. The shared global
        // limiter (below) passes no pattern — its routes keep sharing a bucket.
        const limiter = createRouteLimiter(routeCfg, pattern);
        if (limiter.ownsStore) {
          rateLimitStores.add(limiter.store);
        }
        return limiter;
      }
      if (!options.rateLimit) {
        return null;
      }
      // Internal routes (debug bar, email viewer) never inherit the global
      // limiter — dev tooling polling must not drain the user-facing quota.
      if (pattern in internalRoutes) {
        return null;
      }
      if (!sharedGlobalLimiter) {
        sharedGlobalLimiter = createRouteLimiter(options.rateLimit);
        if (sharedGlobalLimiter.ownsStore) {
          rateLimitStores.add(sharedGlobalLimiter.store);
        }
      }
      return sharedGlobalLimiter;
    }
    function resolveLimiter(routeCfg: MochiRateLimitOptions | false | undefined, pattern: string): void {
      routeLimiters.set(pattern, buildLimiter(routeCfg, pattern));
    }
    function retireLimiter(pattern: string): void {
      const limiter = routeLimiters.get(pattern);
      routeLimiters.delete(pattern);
      // The shared global limiter is never shut down here — other routes still
      // use it, and its counters intentionally survive dev reloads.
      if (limiter && limiter !== sharedGlobalLimiter && limiter.ownsStore) {
        rateLimitStores.delete(limiter.store);
        // async wrapper: sqliteStore's shutdown can throw synchronously (its
        // finalize-verification guard) — a bare Promise.resolve() would let that
        // escape into the dev watcher.
        (async () => limiter.store.shutdown?.())().catch((err: unknown) => {
          logger.warn(`Rate limit store shutdown failed: ${err instanceof Error ? err.message : err}`);
        });
      }
    }
    // Dev-watcher hook for in-place route updates (same pattern, same type):
    // rebuild the limiter so `rateLimit` edits take effect without a restart.
    function updateRouteLimiter(pattern: string, routeCfg: MochiRateLimitOptions | false | undefined): void {
      if (!routeLimiters.has(pattern)) {
        return;
      }
      retireLimiter(pattern);
      resolveLimiter(routeCfg, pattern);
    }

    interface RouteLimitGate {
      headers?: Record<string, string>;
      blockedBody?: Record<string, unknown>;
      blockedMessage?: string;
    }
    async function checkRouteLimit(limiter: RouteLimiter | null, ctx: MochiRequestContext, req: Request): Promise<RouteLimitGate> {
      if (!limiter || ctx.isWarmup) {
        return {};
      }
      const outcome = await limiter.check(req, ctx.getClientAddress);
      if (outcome.kind === 'skip') {
        return {};
      }
      if (outcome.kind === 'allowed') {
        ctx.rateLimit = outcome.info;
        return { headers: outcome.headers };
      }
      // info is null only when the store failed and onStoreError said 'deny' —
      // say so instead of blaming the client's traffic.
      const message =
        outcome.info === null
          ? 'Rate limiting unavailable.'
          : outcome.retryAfterSeconds != null
            ? `Rate limit exceeded. Try again in ${outcome.retryAfterSeconds}s.`
            : 'Rate limit exceeded.';
      return { headers: outcome.headers, blockedBody: outcome.body, blockedMessage: message };
    }

    async function registerRoutePattern(pattern: string, handler: MochiRouteValue): Promise<RouteRegistrationResult | null> {
      if (isMochiPage(handler)) {
        mochiPageMap.set(pattern, handler);
        const { componentPath, serverProps, actions } = handler;
        resolveLimiter(handler.rateLimit, pattern);
        if (pageConfigMap) {
          pageConfigMap.set(pattern, { serverProps, actions });
        }
        if (existsSync(componentPath)) {
          await registry.compile(componentPath);
        }

        const renderComponent = async (req: Request, ctx: MochiRequestContext, resolveOpts: MochiResolveOptions | undefined, statusOverride?: number): Promise<Response> => {
          const compileErrors = registry.getErrors();
          if (compileErrors.length > 0) {
            throw new MochiHttpError(500, formatCompileErrors(compileErrors));
          }
          const liveServerProps = pageConfigMap ? pageConfigMap.get(pattern)?.serverProps : serverProps;
          const baseProps = isServerPropsResolver(liveServerProps) ? ((await liveServerProps(req, ctx.params)) ?? {}) : (liveServerProps ?? {});
          const liveActions = pageConfigMap ? pageConfigMap.get(pattern)?.actions : actions;
          if (liveActions && 'form' in baseProps) {
            throw new Error(
              `[mochi] Route "${pattern}" has form actions and also returns a prop named "form". ` + `"form" is reserved for the form action result — rename your prop.`,
            );
          }
          const formProp = ctx.form ?? null;
          const resolvedProps = formProp === null ? baseProps : { ...baseProps, form: formProp };
          const ssrStart = performance.now();
          const result = await registry.renderComponent(componentPath, resolvedProps);
          if (result.debugBarData) {
            result.debugBarData.ssrDurationMs = Math.round((performance.now() - ssrStart) * 100) / 100;
            if (ctx.requestCache) {
              const { hits, misses, map, perKey } = ctx.requestCache;
              result.debugBarData.requestCache = {
                hits,
                misses,
                entries: map.size,
                keys: [...perKey].map(([key, t]) => ({ key, hits: t.hits, misses: t.misses })),
              };
            }
            if (result.hasServerIslands) {
              const serverIslandSize = new TextEncoder().encode(serverIslandClientJs).length;
              (result.debugBarData.bundles ??= []).push({
                url: '(inline)',
                label: 'Server island runtime',
                sizeBytes: serverIslandSize,
                kind: 'bootstrap',
                inputs: [],
              });
            }
          }
          const html = renderShell(result, {
            debugInfo: result.debugBarData ? { ...result.debugBarData, liveReloadEnabled, ...serverDebugInfo } : undefined,
            pageEntry: liveReloadEnabled ? path.resolve(componentPath) : undefined,
          });
          const response = new Response(html, {
            status: statusOverride,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
          return applyResolveOptions(response, resolveOpts);
        };

        const wrapRequest = async (
          req: Request,
          server: Server<undefined>,
          inner: (ctx: MochiRequestContext, event: MochiEvent, resolveOpts: MochiResolveOptions | undefined) => Promise<Response>,
        ): Promise<Response> => {
          const setup = buildRequestContext(req, server, {
            kind: 'page',
            pattern,
            csrfErrorTransform: (resp) => (isEnhanceRequest(req) ? jsonError(resp.status, 'Cross-site form submission forbidden') : resp),
            deferGuards: true,
          });
          if ('earlyResponse' in setup) {
            return setup.earlyResponse;
          }
          const { ctx, start, requestId, url, params, guardResponse } = setup;
          const event: MochiEvent = { request: req, url, server, locals: ctx.locals, kind: 'page', isWarmup: ctx.isWarmup };

          return requestContext.run(ctx, async () => {
            runHook('route:matched', { pattern, request: req, url, params, kind: 'page' });
            let gateHeaders: Record<string, string> | undefined;
            const innerResolve = async (resolvedEvent: MochiEvent, resolveOpts?: MochiResolveOptions): Promise<Response> => {
              if (guardResponse) {
                return guardResponse;
              }
              const gate = await checkRouteLimit(routeLimiters.get(pattern) ?? null, ctx, resolvedEvent.request);
              gateHeaders = gate.headers;
              if (gate.blockedMessage) {
                // Enhanced form POSTs expect JSON (mirrors csrfErrorTransform above);
                // everything else gets the configured error page at 429.
                return isEnhanceRequest(resolvedEvent.request)
                  ? jsonError(429, gate.blockedMessage)
                  : routeErrorResponse(resolvedEvent.request, resolvedEvent, resolveOpts, new MochiHttpError(429, gate.blockedMessage));
              }
              return inner(ctx, resolvedEvent, resolveOpts);
            };

            const response = middleware ? await middleware({ event, resolve: innerResolve }) : await innerResolve(event);

            let final = finalizeCookieHeaders(response, ctx.cookies);
            if (gateHeaders) {
              final = applyRateLimitHeaders(final, gateHeaders);
            }
            const shipped = await appendDebugTail(final, ctx, development);
            mochiEvents.emit('request', {
              requestId,
              kind: 'page',
              method: req.method,
              path: url.pathname + url.search,
              status: shipped.status,
              duration: performance.now() - start,
              ...(ctx.isWarmup ? { warmup: true } : {}),
            });
            return shipped;
          });
        };

        const getHandler = (req: Request, server: Server<undefined>): Promise<Response> =>
          wrapRequest(req, server, async (ctx, event, resolveOpts) => {
            try {
              return await renderComponent(req, ctx, resolveOpts);
            } catch (err) {
              const response = await routeErrorResponse(req, event, resolveOpts, err);
              emitError('page', ctx.requestId, req, ctx.url, response.status, err);
              return response;
            }
          });

        if (warmupEnabled && isWarmablePattern(pattern)) {
          warmupHandlers.push({ pattern, handler: getHandler });
        }

        if (actions || pageConfigMap) {
          const postHandler = (req: Request, server: Server<undefined>): Promise<Response> =>
            wrapRequest(req, server, async (ctx, event, resolveOpts) => {
              const path = ctx.url.pathname + ctx.url.search;
              const enhanced = isEnhanceRequest(req);
              const emitActionComplete = (actionName: string, result: MochiActionResult, status?: number): void => {
                const payload: {
                  requestId: string;
                  path: string;
                  actionName: string;
                  result: MochiActionResult;
                  status?: number;
                } = { requestId: ctx.requestId, path, actionName, result };
                if (status !== undefined) {
                  payload.status = status;
                }
                mochiEvents.emit('action:complete', payload);
              };

              const livePostActions = pageConfigMap ? pageConfigMap.get(pattern)?.actions : actions;
              if (!livePostActions) {
                return new Response('Method Not Allowed', { status: 405 });
              }

              let actionName = 'default';
              for (const key of ctx.url.searchParams.keys()) {
                if (key.startsWith('/')) {
                  actionName = key.slice(1);
                  break;
                }
              }
              const actionHandler = livePostActions[actionName];
              if (!actionHandler) {
                const unknownErr = new Error(`Unknown form action: ${actionName}`);
                const response = enhanced
                  ? jsonError(404, `Unknown form action: ${actionName}`)
                  : await renderErrorResponse({
                      req,
                      event,
                      resolveOpts,
                      status: 404,
                      message: `Unknown form action: ${actionName}`,
                      thrown: null,
                    });
                emitError('action', ctx.requestId, req, ctx.url, response.status, unknownErr, actionName);
                emitActionComplete(actionName, 'error', response.status);
                return response;
              }

              let formData: FormData;
              try {
                formData = await req.formData();
              } catch (err) {
                const response = enhanced
                  ? jsonError(400, 'Invalid form body')
                  : await renderErrorResponse({
                      req,
                      event,
                      resolveOpts,
                      status: 400,
                      message: 'Invalid form body',
                      thrown: err,
                    });
                emitError('action', ctx.requestId, req, ctx.url, response.status, err, actionName);
                emitActionComplete(actionName, 'error', response.status);
                return response;
              }

              mochiEvents.emit('action:invoke', {
                requestId: ctx.requestId,
                path,
                actionName,
              });

              let result: MochiFormActionResult;
              try {
                result = await actionHandler({
                  request: req,
                  url: ctx.url,
                  server,
                  locals: ctx.locals,
                  kind: 'page',
                  isWarmup: ctx.isWarmup,
                  method: 'POST' as HttpMethod,
                  formData,
                  actionName,
                  cookies: ctx.cookies,
                  params: ctx.params,
                });
              } catch (err) {
                if (enhanced) {
                  const response = await handleEnhancedError(err, event);
                  emitError('action', ctx.requestId, req, ctx.url, response.status, err, actionName);
                  emitActionComplete(actionName, 'error', response.status);
                  return response;
                }
                const response = await routeErrorResponse(req, event, resolveOpts, err);
                emitError('action', ctx.requestId, req, ctx.url, response.status, err, actionName);
                emitActionComplete(actionName, 'error', response.status);
                return response;
              }

              if (result instanceof Response) {
                emitActionComplete(actionName, 'success', result.status);
                return applyResolveOptions(result, resolveOpts);
              }
              if (isFormRedirect(result)) {
                emitActionComplete(actionName, 'redirect', result.status);
                if (enhanced) {
                  return jsonRedirect(result.status, result.location);
                }
                const redirectResponse = new Response(null, {
                  status: result.status,
                  headers: { Location: result.location },
                });
                return applyResolveOptions(redirectResponse, resolveOpts);
              }
              try {
                if (isFormFail(result)) {
                  if (enhanced) {
                    emitActionComplete(actionName, 'fail', result.status);
                    return jsonFailure(result.status, result.data);
                  }
                  ctx.form = {
                    ok: false,
                    action: actionName,
                    status: result.status,
                    data: result.data,
                  };
                  emitActionComplete(actionName, 'fail', result.status);
                  return await renderComponent(req, ctx, resolveOpts, result.status);
                }
                if (enhanced) {
                  emitActionComplete(actionName, 'success');
                  if (result === undefined || result === null) {
                    return jsonSuccess(undefined, { emptyResult: true });
                  }
                  return jsonSuccess(isFormSuccess(result) ? result.data : {});
                }
                const data = isFormSuccess(result) ? result.data : {};
                ctx.form = { ok: true, action: actionName, data };
                emitActionComplete(actionName, 'success');
                return await renderComponent(req, ctx, resolveOpts);
              } catch (err) {
                if (enhanced) {
                  const response = await handleEnhancedError(err, event);
                  emitError('action', ctx.requestId, req, ctx.url, response.status, err, actionName);
                  return response;
                }
                const response = await routeErrorResponse(req, event, resolveOpts, err);
                emitError('action', ctx.requestId, req, ctx.url, response.status, err, actionName);
                return response;
              }
            });

          return {
            bunRouteValue: withHead({
              GET: getHandler,
              POST: postHandler,
            } as unknown as BunRouteValue),
            type: 'page',
          };
        }
        // Register as a method-keyed object (not a bare function) so Bun 405s a
        // POST/PUT/etc. to an action-less page. A bare function is invoked for
        // every method and would render 200 on POST in production, diverging from
        // dev (where `pageConfigMap` forces the method-keyed path below).
        return { bunRouteValue: withHead({ GET: getHandler } as unknown as BunRouteValue), type: 'page' };
      } else if (isMochiApi(handler)) {
        if (apiHandlerMap) {
          apiHandlerMap.set(pattern, handler.handler);
        }
        const capturedApiHandler = handler.handler;
        resolveLimiter(handler.rateLimit, pattern);

        const bunRouteValue: BunRouteValue = async (req: Request, server: Server<undefined>): Promise<Response> => {
          const setup = buildRequestContext(req, server, { kind: 'api', pattern, deferGuards: true });
          if ('earlyResponse' in setup) {
            return setup.earlyResponse;
          }
          const { ctx, start, requestId, url, params, guardResponse } = setup;

          return requestContext.run(ctx, async () => {
            runHook('route:matched', { pattern, request: req, url, params, kind: 'api' });
            const event: MochiEvent = { request: req, url, server, locals: ctx.locals, kind: 'api', isWarmup: ctx.isWarmup };

            let gateHeaders: Record<string, string> | undefined;
            const innerResolve = async (event: MochiEvent, resolveOpts?: MochiResolveOptions): Promise<Response> => {
              if (guardResponse) {
                return guardResponse;
              }
              const gate = await checkRouteLimit(routeLimiters.get(pattern) ?? null, ctx, event.request);
              gateHeaders = gate.headers;
              if (gate.blockedBody) {
                return Response.json(gate.blockedBody, { status: 429 });
              }
              const apiEvent = {
                ...event,
                method: event.request.method as HttpMethod,
                params: ctx.params,
                cookies: ctx.cookies,
              };
              try {
                const apiHandler = (apiHandlerMap ? apiHandlerMap.get(pattern) : undefined) ?? capturedApiHandler;
                const response = await apiHandler(apiEvent);
                return applyResolveOptions(response, resolveOpts);
              } catch (err) {
                if (err instanceof MochiHttpError) {
                  logger.error(`${event.request.method} ${event.url.pathname} → ${err.status}: ${err.message}`);
                  emitError('api', requestId, req, event.url, err.status, err);
                  return apiError(err.status, err.message);
                }
                logger.error(`${event.request.method} ${event.url.pathname} → 500:`, err);
                emitError('api', requestId, req, event.url, 500, err);
                return apiError(500, 'Internal Server Error');
              }
            };

            const response = middleware ? await middleware({ event, resolve: innerResolve }) : await innerResolve(event);

            let final = finalizeCookieHeaders(response, ctx.cookies);
            if (gateHeaders) {
              final = applyRateLimitHeaders(final, gateHeaders);
            }
            mochiEvents.emit('request', {
              requestId,
              kind: 'api',
              method: req.method,
              path: url.pathname + url.search,
              status: final.status,
              duration: performance.now() - start,
            });
            return final;
          });
        };
        return { bunRouteValue: withHead(bunRouteValue), type: 'api' };
      } else if (isMochiWs(handler)) {
        const wsHandlers = handler.handlers;
        wsHandlersMap.set(pattern, wsHandlers);
        const wsOriginOptions = handler.origin ?? {};
        const wsTrustedOrigins = resolveWsTrustedOrigins(wsOriginOptions, `Mochi.ws route ${JSON.stringify(pattern)}`);

        const bunRouteValue = (async (req: Request, server: Server<undefined>) => {
          const setup = buildRequestContext(req, server, { kind: 'ws', pattern });
          if ('earlyResponse' in setup) {
            return setup.earlyResponse;
          }
          const { ctx, start, requestId, url, params } = setup;
          const wsUrl = url;
          const wsParams = params;
          const wsPath = wsUrl.pathname + wsUrl.search;

          return requestContext.run(ctx, async () => {
            runHook('route:matched', {
              pattern,
              request: req,
              url: wsUrl,
              params: wsParams,
              kind: 'ws',
            });
            const event: MochiEvent = { request: req, url: wsUrl, server, locals: ctx.locals, kind: 'ws', isWarmup: ctx.isWarmup };
            const upgradeSentinel = new Response(null, { status: 204 });
            let resolvedEvent = event;
            const innerResolve = async (nextEvent: MochiEvent): Promise<Response> => {
              resolvedEvent = nextEvent;
              return upgradeSentinel;
            };

            const middlewareResponse = middleware ? await middleware({ event, resolve: innerResolve }) : await innerResolve(event);
            if (middlewareResponse !== upgradeSentinel) {
              const final = finalizeCookieHeaders(middlewareResponse, ctx.cookies);
              mochiEvents.emit('request', {
                requestId,
                kind: 'ws',
                method: req.method,
                path: wsPath,
                status: final.status,
                duration: performance.now() - start,
              });
              return final;
            }

            const originResponse = wsOriginCheck(resolvedEvent.request, resolvedEvent.url, wsOriginOptions, wsTrustedOrigins);
            if (originResponse) {
              const final = finalizeCookieHeaders(originResponse, ctx.cookies);
              mochiEvents.emit('request', {
                requestId,
                kind: 'ws',
                method: req.method,
                path: wsPath,
                status: final.status,
                duration: performance.now() - start,
              });
              return final;
            }

            // A non-upgrade request (e.g. a HEAD probe or plain GET) never becomes
            // a socket, so it never emits `ws:open`.
            const emitWsResult = (status: number): void => {
              mochiEvents.emit('request', {
                requestId,
                kind: 'ws',
                method: req.method,
                path: wsPath,
                status,
                duration: performance.now() - start,
              });
            };
            let userData: unknown = undefined;

            const liveWsHandlers = wsHandlersMap.get(pattern) ?? wsHandlers;
            if (liveWsHandlers.upgrade) {
              const result = await liveWsHandlers.upgrade(resolvedEvent.request, wsParams);
              if (result === false) {
                emitWsResult(400);
                return new Response('WebSocket upgrade rejected', {
                  status: 400,
                });
              }
              userData = result;
            }

            const success = (
              server as unknown as {
                upgrade: (req: Request, opts: Record<string, unknown>) => boolean;
              }
            ).upgrade(resolvedEvent.request, {
              data: {
                __mochiRoutePattern: pattern,
                __mochiOpenedAt: performance.now(),
                __mochiPath: wsPath,
                user: userData,
              } satisfies MochiWsData,
            });

            if (!success) {
              emitWsResult(400);
              return new Response('WebSocket upgrade failed', { status: 400 });
            }
            emitWsResult(101);
            mochiEvents.emit('ws:open', {
              path: wsPath,
              duration: performance.now() - start,
            });
            return undefined;
          });
        }) as unknown as BunRouteValue;
        return { bunRouteValue, type: 'ws' };
      } else if (isMochiSse(handler)) {
        if (sseHandlerMap) {
          sseHandlerMap.set(pattern, handler.handler);
        }
        const capturedSseHandler = handler.handler;

        const bunRouteValue: BunRouteValue = async (req: Request, server: Server<undefined>): Promise<Response> => {
          const setup = buildRequestContext(req, server, { kind: 'sse', pattern, deferGuards: true });
          if ('earlyResponse' in setup) {
            return setup.earlyResponse;
          }
          const { ctx, start, requestId, url, params, guardResponse } = setup;
          const requestPath = url.pathname + url.search;

          return requestContext.run(ctx, async () => {
            runHook('route:matched', {
              pattern,
              request: req,
              url,
              params,
              kind: 'sse',
            });

            const event: MochiEvent = { request: req, url, server, locals: ctx.locals, kind: 'sse', isWarmup: ctx.isWarmup };
            const innerResolve = async (resolvedEvent: MochiEvent): Promise<Response> => {
              if (guardResponse) {
                return guardResponse;
              }
              if (resolvedEvent.request.method !== 'GET') {
                return new Response(null, {
                  status: 405,
                  headers: { Allow: 'GET', 'Cache-Control': 'no-store' },
                });
              }

              let closed = false;
              let openedAt = 0;
              let closeCallbacks: Array<() => void> = [];
              let controller: ReadableStreamDefaultController<string>;

              const emitClose = () => {
                if (closed) {
                  return;
                }
                closed = true;
                mochiEvents.emit('sse:close', {
                  path: requestPath,
                  duration: performance.now() - openedAt,
                });
              };
              const failStream = (err: unknown): void => {
                logger.error(`SSE handler for ${requestPath} failed:`, err);
                emitError('sse', requestId, resolvedEvent.request, resolvedEvent.url, 500, err);
                try {
                  // The HTTP 200 and stream have already been committed. End the
                  // connection without surfacing an unhandled stream rejection in
                  // the server process; the error event/log above is the diagnostic.
                  controller.close();
                } catch {
                  // The client may have disconnected or the handler may already
                  // have closed the stream. Either way, cleanup still runs.
                }
                emitClose();
              };

              const body = new ReadableStream<string>({
                start(ctrl) {
                  controller = ctrl;
                  openedAt = performance.now();
                  mochiEvents.emit('sse:open', { path: requestPath });
                  const stream: MochiSseStream = {
                    send(data, opts) {
                      if (opts?.id && /[\r\n]/.test(opts.id)) {
                        throw new TypeError('SSE event id must not contain CR or LF.');
                      }
                      if (opts?.event && /[\r\n]/.test(opts.event)) {
                        throw new TypeError('SSE event name must not contain CR or LF.');
                      }
                      let frame = '';
                      if (opts?.id) {
                        frame += `id: ${opts.id}\n`;
                      }
                      if (opts?.event) {
                        frame += `event: ${opts.event}\n`;
                      }
                      for (const line of data.split(/\r\n|\r|\n/)) {
                        frame += `data: ${line}\n`;
                      }
                      frame += '\n';
                      controller.enqueue(frame);
                      mochiEvents.emit('sse:message', {
                        path: requestPath,
                        size: Buffer.byteLength(data, 'utf8'),
                        event: opts?.event,
                      });
                    },
                    close() {
                      controller.close();
                      emitClose();
                    },
                    onClose(cb) {
                      closeCallbacks.push(cb);
                    },
                  };
                  const liveSseHandler = (sseHandlerMap ? sseHandlerMap.get(pattern) : undefined) ?? capturedSseHandler;
                  try {
                    void Promise.resolve(liveSseHandler(stream, resolvedEvent.request)).catch(failStream);
                  } catch (err) {
                    failStream(err);
                  }
                },
                cancel() {
                  for (const cb of closeCallbacks) {
                    cb();
                  }
                  closeCallbacks = [];
                  emitClose();
                },
              });

              return new Response(body, {
                headers: {
                  'Content-Type': 'text/event-stream',
                  'Cache-Control': 'no-cache',
                  Connection: 'keep-alive',
                },
              });
            };

            const response = middleware ? await middleware({ event, resolve: innerResolve }) : await innerResolve(event);
            const final = finalizeCookieHeaders(response, ctx.cookies);
            mochiEvents.emit('request', {
              requestId,
              kind: 'sse',
              method: req.method,
              path: requestPath,
              status: final.status,
              duration: performance.now() - start,
            });
            return final;
          });
        };
        return { bunRouteValue, type: 'sse' };
      } else if (isMochiFile(handler)) {
        const source = handler.source;

        const bunRouteValue: BunRouteValue = async (req: Request, server: Server<undefined>): Promise<Response> => {
          const setup = buildRequestContext(req, server, { kind: 'file', pattern });
          if ('earlyResponse' in setup) {
            return setup.earlyResponse;
          }
          const { ctx, start, requestId, url, params } = setup;

          return requestContext.run(ctx, async () => {
            runHook('route:matched', { pattern, request: req, url, params, kind: 'file' });
            const event: MochiEvent = { request: req, url, server, locals: ctx.locals, kind: 'file', isWarmup: ctx.isWarmup };
            const innerResolve = async (resolvedEvent: MochiEvent): Promise<Response> => {
              try {
                const filePath = typeof source === 'function' ? await source(resolvedEvent.request, ctx.params) : source;
                // Route params are URL-decoded and may contain `../`, so confine the
                // resolved path to the app root. `realpath` resolves symlinks first —
                // so a symlink inside the root pointing outside can't escape — and
                // also proves the file exists (ENOENT → 404). Containment is checked
                // via `path.relative` (handles separators and canonical casing).
                const resolvedPath = path.resolve(filePath);
                let realPath: string;
                try {
                  realPath = await realpath(resolvedPath);
                } catch {
                  emitError('file', requestId, resolvedEvent.request, resolvedEvent.url, 404, new Error(`File not found: ${filePath}`));
                  return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
                }
                const appRoot = process.cwd();
                const rel = path.relative(appRoot, realPath);
                if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
                  emitError('file', requestId, resolvedEvent.request, resolvedEvent.url, 404, new Error(`Path escapes the app root: ${filePath}`));
                  return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
                }
                // Reject dotfiles / dot-directories (`.env`, `.mochi/…`, `.git/…`, source
                // files, etc.) that live *inside* the root — the containment check above
                // only stops escaping it. `.well-known` stays allowed, matching the
                // public-dir policy.
                if (isExcludedDotPath(toPosixPath(rel))) {
                  emitError('file', requestId, resolvedEvent.request, resolvedEvent.url, 404, new Error(`Refusing to serve dotfile path: ${filePath}`));
                  return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
                }
                const file = Bun.file(realPath);
                // `realpath` proves the path exists, but it resolves directories too;
                // `Bun.file(dir).exists()` is false, so this also turns a directory
                // target into a 404 instead of streaming it (EISDIR → 500).
                if (!(await file.exists())) {
                  emitError('file', requestId, resolvedEvent.request, resolvedEvent.url, 404, new Error(`File not found: ${filePath}`));
                  return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
                }
                if (resolvedEvent.request.method === 'HEAD') {
                  return new Response(null, { status: 200, headers: { 'Content-Type': file.type || 'application/octet-stream', 'Content-Length': String(file.size) } });
                }
                // new Response(Bun.file) sets Content-Type and Content-Length automatically.
                return new Response(file);
              } catch (err) {
                if (err instanceof MochiHttpError) {
                  logger.error(`${resolvedEvent.request.method} ${resolvedEvent.url.pathname} → ${err.status}: ${err.message}`);
                  emitError('file', requestId, resolvedEvent.request, resolvedEvent.url, err.status, err);
                  return new Response(err.message, { status: err.status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
                }
                logger.error(`${resolvedEvent.request.method} ${resolvedEvent.url.pathname} → 500:`, err);
                emitError('file', requestId, resolvedEvent.request, resolvedEvent.url, 500, err);
                return new Response('Internal Server Error', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
              }
            };

            const response = middleware ? await middleware({ event, resolve: innerResolve }) : await innerResolve(event);
            const final = finalizeCookieHeaders(response, ctx.cookies);
            mochiEvents.emit('request', {
              requestId,
              kind: 'file',
              method: req.method,
              path: url.pathname + url.search,
              status: final.status,
              duration: performance.now() - start,
            });
            return final;
          });
        };
        return { bunRouteValue, type: 'file' };
      }
      return null;
    }

    function unregisterRoutePattern(pattern: string): void {
      mochiPageMap.delete(pattern);
      apiHandlerMap?.delete(pattern);
      sseHandlerMap?.delete(pattern);
      wsHandlersMap?.delete(pattern);
      pageConfigMap?.delete(pattern);
      // Dev re-registration creates a fresh limiter — shut down the outgoing
      // per-route store so its sweep timer / sqlite handle doesn't leak.
      retireLimiter(pattern);
    }

    if (allRoutes) {
      for (const [pattern, handler] of Object.entries(allRoutes)) {
        const result = await registerRoutePattern(pattern, handler);
        if (result) {
          bunRoutes[pattern] = result.bunRouteValue;
          routeCounts[result.type] += 1;
        } else {
          bunRoutes[pattern] = wrapRawRouteValue(pattern, handler as BunRouteValue);
        }
      }
    }

    // Register the alt-slash variant of every user route so Bun's literal
    // pattern matcher matches both `/foo` and `/foo/`. The per-handler
    // redirect checks above turn the non-canonical form into a 301/308.
    if (trailingSlashPolicy) {
      for (const [pattern, value] of Object.entries(bunRoutes)) {
        const alt = alternateSlashPattern(pattern);
        if (alt && !(alt in bunRoutes)) {
          bunRoutes[alt] = value;
        }
      }
    }

    // Register server island endpoint
    bunRoutes[`${registry.assetPrefix}/island/:componentName`] = withHead(async (req: Request, server: Server<undefined>): Promise<Response> => {
      const setup = buildRequestContext(req, server, {
        kind: 'island',
        pattern: `${registry.assetPrefix}/island/:componentName`,
        paramsOverride: {},
      });
      if ('earlyResponse' in setup) {
        return setup.earlyResponse;
      }
      const { ctx, start, requestId, url, params } = setup;
      return requestContext.run(ctx, async () => {
        runHook('route:matched', {
          pattern: `${registry.assetPrefix}/island/:componentName`,
          request: req,
          url,
          params,
          kind: 'island',
        });
        const event: MochiEvent = { request: req, url, server, locals: ctx.locals, kind: 'island', isWarmup: ctx.isWarmup };
        const innerResolve = async (_resolvedEvent: MochiEvent, resolveOpts?: MochiResolveOptions): Promise<Response> => {
          const componentName = params.componentName;
          if (!componentName) {
            return new Response('Missing component name', { status: 400 });
          }

          const signedProps = url.searchParams.get('props') ?? '';

          // Decrypt props (empty means no props)
          let decodedProps: Record<string, unknown>;
          if (signedProps) {
            const propsJson = decryptProps(signedProps, componentName);
            if (propsJson === null) {
              return new Response('Invalid props', { status: 403 });
            }
            decodedProps = devalueParse(propsJson) as Record<string, unknown>;
          } else {
            decodedProps = {};
          }

          // `islandId` and `__mochi_ah` (the authored also-hydrate mode) ride inside
          // the signed envelope as transport only — islandId identifies the wrapper for
          // debug/error reporting, `__mochi_ah` says whether the island opted into
          // hydration. Neither must reach the component as a prop (components use
          // `$props.id()` for ids). Split them off into a fresh object rather than
          // deleting in place.
          //
          // The hydrate mode is read from the *decrypted* payload, never from a query
          // param: trusting `?hydrate=` would let anyone append it to a sealed token and
          // have the endpoint echo the decrypted props back in plaintext (a decryption
          // oracle against pure `mochi:defer` islands).
          const { [ALSO_HYDRATE_ENVELOPE_KEY]: rawHydrateMode, islandId: rawIslandId, ...props } = decodedProps;
          const islandId = typeof rawIslandId === 'string' ? rawIslandId : undefined;
          const hydrateMode = isAlsoHydrateMode(rawHydrateMode) ? rawHydrateMode : null;

          // Look up the component path
          const componentPath = registry.getServerIslandPath(componentName);
          if (!componentPath) {
            return new Response('Unknown server island component', { status: 404 });
          }

          // A miss here means the build's eager discovery (see build.ts) didn't
          // find this island — expected to be unreachable in practice, so treat
          // it as a framework bug rather than silently eating the request-path
          // compile it's supposed to prevent.
          if (!registry.development && registry.loadedFromManifest && !registry.isCompiled(componentPath)) {
            logger.warn(
              `[mochi] Server island "${componentName}" was missing from the prebuilt manifest and is compiling on the request path. ` +
                `This likely indicates a Mochi bug in server-island discovery during \`mochi-framework build\` — please report it with a reproduction if possible.`,
            );
          }
          // Compile the server island component directly
          await registry.compile(componentPath);
          let result: RenderResult;
          try {
            // Namespacing via `idPrefix` keeps `$props.id()` values from this
            // standalone render from colliding with ids the host page already
            // emitted (both renders otherwise start their uid counter at `s1`).
            // Svelte rejects prefixes containing `--`, so guard against tokens
            // signed by an older deploy carrying an incompatible id.
            result = await registry.renderComponent(componentPath, props as Record<string, unknown>, {
              stripMarkers: false,
              ...(islandId && !islandId.includes('--') ? { idPrefix: islandId } : {}),
              // An also-hydrate island's standalone render seeds the
              // `isHydratable()` context for its whole subtree — the same signal
              // the in-page boundary component provides for `mochi:hydrate*`
              // islands. Pure `mochi:defer` never hydrates, so no context.
              ...(hydrateMode !== null ? { context: new Map<unknown, unknown>([[HYDRATABLE_CONTEXT_KEY, true]]) } : {}),
              // Named-export islands render that export, not the module's default.
              ...(registry.getServerIslandExport(componentName) ? { exportName: registry.getServerIslandExport(componentName) } : {}),
            });
          } catch (err) {
            const e = err instanceof Error ? err : new Error(String(err));
            logger.error(`Server island "${componentName}" failed: ${e.message}`);
            mochiEvents.emit('island:error', {
              componentName,
              islandId,
              kind: 'server',
              message: e.message,
              stack: registry.development ? e.stack : undefined,
            });
            // 200 + a known stub so `ServerIsland.ts` doesn't burn its retry budget
            // on a deterministic failure. Visibility is CSS-controlled: dev shows
            // the message, prod hides the element entirely.
            const stub = islandFailureStub(componentName, registry.development ? e.message : undefined);
            return applyResolveOptions(
              new Response(stub, {
                status: 200,
                headers: {
                  'Content-Type': 'text/html; charset=utf-8',
                  'Cache-Control': 'private, no-store',
                },
              }),
              resolveOpts,
            );
          }

          let body = result.body;

          // If also-hydrate is requested, wrap in hydratable island
          if (isAlsoHydrateMode(hydrateMode)) {
            const componentUrl = registry.getComponentEntryUrl(componentName);
            const serializedProps = devalueStringify(props);
            const bootstrapUrl = registry.getIslandBootstrapUrl();

            let hydrateAttrs = `component-name="${componentName}"`;
            if (Object.keys(props as Record<string, unknown>).length > 0) {
              hydrateAttrs += ` props="${escapeHtmlAttr(serializedProps)}"`;
            }
            if (componentUrl) {
              hydrateAttrs += ` component-url="${componentUrl}"`;
            }

            body = `<mochi-hydratable-island ${hydrateAttrs}>${body}</mochi-hydratable-island>`;

            // Include bootstrap script so the hydratable island can hydrate
            if (bootstrapUrl) {
              body += `<script type="module" src="${bootstrapUrl}"></script>`;
            }
          }

          // Prepend <link> tags for CSS the host page never linked: hydratable
          // islands rendered only inside this deferred content (their CSS is gated
          // out of the page <head> because they aren't rendered at page time), plus
          // any side-effect CSS imports. Browsers load <link> assigned via the
          // client's `innerHTML`, so these apply as soon as the island appears. The
          // island's own scoped CSS already loads via the wrapper's `css-url`
          // attribute, so exclude it to avoid a duplicate tag.
          const ownCss = registry.getComponentCssUrl(componentPath);
          const extraCss = result.cssUrls.filter((url) => url !== ownCss);
          if (extraCss.length > 0) {
            body = extraCss.map(cssLinkTag).join('') + body;
          }

          return applyResolveOptions(
            new Response(body, {
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'private, no-store',
              },
            }),
            resolveOpts,
          );
        };

        const response = middleware ? await middleware({ event, resolve: innerResolve }) : await innerResolve(event);
        const final = finalizeCookieHeaders(response, ctx.cookies);
        mochiEvents.emit('request', {
          requestId,
          kind: 'island',
          method: req.method,
          path: url.pathname + url.search,
          status: final.status,
          duration: performance.now() - start,
        });
        return final;
      });
    });

    // Give the mailer a handle to the live compile cache so Mochi.email() can
    // render Svelte email templates through the same registry as page routes.
    getEmailRuntime().registry = registry;

    // Register the signed image endpoint (enabled unless explicitly off) and
    // start the background cache janitor. The resolved options are the single
    // source of truth for `enabled` — `getImageUrl` consults the same flag to
    // fall back to raw source URLs when the endpoint is off.
    let stopImageSweeper: (() => void) | undefined;
    const imageRuntime = getImageRuntime();
    if (imageRuntime.options.enabled) {
      const imageHandler = createImageHandler();
      const imagePattern = `${registry.assetPrefix}/image/:filename`;
      bunRoutes[imagePattern] = withHead(async (req: Request, server: Server<undefined>): Promise<Response> =>
        runSimpleRequest(req, server, 'image', imagePattern, async (event, resolveOpts) => applyResolveOptions(await imageHandler(event.request), resolveOpts)),
      );
      stopImageSweeper = startImageCacheSweeper(imageRuntime.cache, imageRuntime.options.sweepIntervalMs);
    }

    // Serve locally-imported image assets (`import x from './x.png'`) from disk.
    // Registered unconditionally — this is plain static serving, independent of
    // whether the transform endpoint (`image.enabled`) is on. The handler reads
    // the global registry the build populated (in-process in dev, from the
    // manifest in prod), so new images in dev need no route reload.
    const localAssetPattern = `${registry.assetPrefix}/asset/:filename`;
    bunRoutes[localAssetPattern] = withHead(wrapRawRouteValue(localAssetPattern, createLocalAssetHandler(development), 'asset'));

    // Dev-only: the debug bar's Cache tab reads the entry count (GET) and empties
    // the image cache (POST). Registered whenever the debug bar is on (independent
    // of the image endpoint), since the tab always shows; counting/clearing an
    // unpopulated cache is a harmless no-op.
    if (debugBarEnabled) {
      const imageCacheHandler = async (req: Request): Promise<Response> => {
        if (req.method === 'POST') {
          await imageRuntime.cache.clearAll();
          return Response.json({ ok: true, count: 0, keys: [] });
        }
        if (req.method === 'GET') {
          // `keys` already excludes transient in-flight markers; count matches the
          // visible list so the debug bar badge equals the number of listed keys.
          const keys = await imageRuntime.cache.keys();
          return Response.json({ count: keys.length, keys });
        }
        return new Response('Method Not Allowed', { status: 405 });
      };
      // Returns the raw stored entry for a single key (`?key=<url-encoded key>`).
      const imageCacheEntryHandler = async (req: Request): Promise<Response> => {
        if (req.method !== 'GET') {
          return new Response('Method Not Allowed', { status: 405 });
        }
        const key = new URL(req.url).searchParams.get('key');
        if (!key) {
          return new Response('Missing ?key', { status: 400 });
        }
        const value = await imageRuntime.cache.inspect(key);
        if (value == null) {
          // 410, not 404: the handler ran and the key simply isn't stored — the
          // listing it came from is a snapshot, and entries are evicted between
          // listing and expanding. A 404 here would be indistinguishable from the
          // route being unregistered or the key arriving mangled.
          return new Response('Gone', { status: 410 });
        }
        return Response.json({ key, value });
      };
      // Register both slash variants so they work under any `trailingSlash` policy.
      for (const route of [`${registry.assetPrefix}/image-cache`, `${registry.assetPrefix}/image-cache/`]) {
        bunRoutes[route] = wrapRawRouteValue(route, imageCacheHandler, 'dev');
      }
      for (const route of [`${registry.assetPrefix}/image-cache/entry`, `${registry.assetPrefix}/image-cache/entry/`]) {
        bunRoutes[route] = wrapRawRouteValue(route, imageCacheEntryHandler, 'dev');
      }
    }

    if (process.env.MOCHI_MEMORY_PROBE === '1') {
      const memoryProbe = (): Response => {
        Bun.gc(true);
        return Response.json({
          timestamp: Date.now(),
          memory: process.memoryUsage(),
        });
      };
      bunRoutes['/__mochi/health/memory'] = wrapRawRouteValue('/__mochi/health/memory', memoryProbe, 'dev');
    }

    // Snapshot the non-public route set so the dev-mode public watcher can
    // rebuild cleanly when files are added/removed/renamed.
    const baseBunRoutes: Record<string, BunRouteValue> = { ...bunRoutes };

    // Register static public files. Dev scans the public dir live, production
    // reads the prebuilt manifest map; either way user-defined routes win, so a
    // public route is only added when no user route claims the path. The
    // dev-watcher reload rebuilds these the same way via the same helpers.
    const initialPublicFiles = await resolvePublicFiles({ publicDir, development, prebuilt: registry.getPublicFiles() });
    registerPublicRoutes(bunRoutes, initialPublicFiles, (route, value) => wrapRawRouteValue(route, value, 'asset'));

    const userFetch = options.fetch;

    const composedFetch = async (req: Request, server: Server<undefined>): Promise<Response> => {
      const requestPathname = new URL(req.url).pathname;
      const assetContent = registry.getClientFile(requestPathname);
      const kind: SimpleMiddlewareKind = assetContent !== undefined ? 'asset' : userFetch ? 'fallback' : 'error';

      const response = await runSimpleRequest(req, server, kind, '/*', async (event, resolveOpts) => {
        if (assetContent !== undefined) {
          // getClientFile() only returns registered .js or .css; determine type
          // by extension so this branch doesn't depend on the asset prefix.
          const contentType = event.url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript';
          const headers: Record<string, string> = { 'Content-Type': contentType };
          // Filenames are content-hashed (Bun.hash), so URLs change whenever
          // bytes change — safe to mark immutable in prod. Skipped in dev so
          // live-reload edits aren't pinned in the browser cache.
          if (!development) {
            headers['Cache-Control'] = 'public, max-age=31536000, immutable';
          }
          return applyResolveOptions(new Response(assetContent, { headers }), resolveOpts);
        }
        if (userFetch) {
          const fallbackResponse = await userFetch(event.request, server);
          return applyResolveOptions(fallbackResponse, resolveOpts);
        }
        return renderErrorResponse({
          req: event.request,
          event,
          resolveOpts,
          status: 404,
          message: 'Not Found',
          thrown: null,
        });
      });
      if (req.method === 'HEAD') {
        return headResponse(response);
      }
      return response;
    };

    const {
      routes: _routes,
      fetch: _fetch,
      htmlShell: _htmlShell,
      handle: _handle,
      markdown: _markdown,
      websocket: userWebSocketOptions,
      ...bunOptions
    } = options as Record<string, unknown>;

    // Internal HMR live-reload socket. Registered before the dispatcher is
    // built so it shares the same Bun WebSocket option as user `Mochi.ws()`
    // routes, and so `wsHandlersMap.size > 0` is true even when the user has
    // no WebSocket routes of their own.
    const liveReloadClients = new Set<ServerWebSocket<MochiWsData>>();
    let stopEmailBadgeBroadcast: (() => void) | undefined;
    if (liveReloadEnabled) {
      wsHandlersMap.set('/__mochi_live_reload', {
        open(ws) {
          const client = ws as ServerWebSocket<MochiWsData>;
          liveReloadClients.add(client);
          try {
            client.send(liveReloadGreeting(client.data.__mochiEntry));
          } catch {
            liveReloadClients.delete(client);
          }
        },
        // The client heartbeat needs an application-level reply: proxies and
        // sleeping network stacks can swallow protocol pings, leaving a socket
        // that reads OPEN but is dead.
        message(ws, message) {
          if (typeof message === 'string' && message === 'ping') {
            ws.send('pong');
          }
        },
        close(ws) {
          liveReloadClients.delete(ws as ServerWebSocket<MochiWsData>);
        },
      });

      // Fan dev-outbox arrivals out over the same live-reload socket so open tabs
      // can surface a "new email" badge (and the outbox page itself can live-reload)
      // without a second WebSocket. The captured id rides along so the toolbar can
      // track which messages are still unread.
      stopEmailBadgeBroadcast = onDevEmailRecorded((email) => {
        for (const client of liveReloadClients) {
          try {
            client.send(`email:new:${email.id}`);
          } catch {
            liveReloadClients.delete(client);
          }
        }
      });
    }

    const websocketOption =
      wsHandlersMap.size > 0
        ? {
            ...(typeof userWebSocketOptions === 'object' ? userWebSocketOptions : {}),
            open(ws: ServerWebSocket<MochiWsData>) {
              wsHandlersMap.get(ws.data.__mochiRoutePattern)?.open?.(ws);
            },
            message(ws: ServerWebSocket<MochiWsData>, message: string | Buffer) {
              wsHandlersMap.get(ws.data.__mochiRoutePattern)?.message(ws, message);
              mochiEvents.emit('ws:message', {
                path: ws.data.__mochiPath,
                size: typeof message === 'string' ? Buffer.byteLength(message, 'utf8') : message.byteLength,
                type: typeof message === 'string' ? 'text' : 'binary',
              });
            },
            close(ws: ServerWebSocket<MochiWsData>, code: number, reason: string) {
              wsHandlersMap.get(ws.data.__mochiRoutePattern)?.close?.(ws, code, reason);
              mochiEvents.emit('ws:close', {
                path: ws.data.__mochiPath,
                duration: performance.now() - ws.data.__mochiOpenedAt,
                code,
                reason,
              });
            },
            drain(ws: ServerWebSocket<MochiWsData>) {
              wsHandlersMap.get(ws.data.__mochiRoutePattern)?.drain?.(ws);
            },
          }
        : userWebSocketOptions;

    // Validate queues BEFORE binding so a misconfiguration fails fast without
    // leaving a half-started server listening.
    for (const [name, config] of Object.entries(options.queues ?? {})) {
      if (!isMochiQueue(config)) {
        throw new Error(`Mochi.serve({ queues }): "${name}" is not a Mochi.queue(...) descriptor. Each value must be created with Mochi.queue().`);
      }
    }

    const server = Bun.serve({
      ...bunOptions,
      routes: bunRoutes,
      fetch: composedFetch,
      ...(websocketOption ? { websocket: websocketOption } : {}),
    } as Parameters<typeof Bun.serve>[0]);

    // Tie subsystem cleanup to the server's lifetime: any stop path (tests
    // calling server.stop(), or the signal handler below) clears the image-cache
    // sweep timers and closes a pooled SMTP connection instead of leaking them.
    // Wrapping stop covers both, since the signal handler calls server.stop().
    {
      const sweeperStop = stopImageSweeper;
      const stopServer = server.stop.bind(server);
      // The shutdown path calls stop() twice (graceful, then forced once the
      // grace period lapses); tearing subsystems down a second time would
      // double-close an already-closed transport, so run them only once.
      let cleanedUp = false;
      server.stop = (async (closeActiveConnections?: boolean) => {
        if (cleanedUp) {
          return stopServer(closeActiveConnections);
        }
        cleanedUp = true;
        // Subsystem cleanup must never gate the socket close: a transport whose
        // close() throws (e.g. a nodemailer pool) would otherwise leave the
        // listener open and hang shutdown. Best-effort, then always stop.
        try {
          sweeperStop?.();
          stopEmailBadgeBroadcast?.();
          await closeEmailTransport();
          for (const store of rateLimitStores) {
            // Per-store guard: one failing shutdown must not skip the rest.
            try {
              await store.shutdown?.();
            } catch (err) {
              logger.warn(`Rate limit store shutdown failed: ${err instanceof Error ? err.message : err}`);
            }
          }
        } catch (err) {
          logger.warn(`Subsystem cleanup failed during shutdown: ${err instanceof Error ? err.message : err}`);
        }
        return stopServer(closeActiveConnections);
      }) as typeof server.stop;
    }

    await runHook('mochi:listening', { options, server });

    {
      const startEvent: MochiServerStartEvent = {
        development,
        routes: { ...routeCounts },
      };
      if (typeof server.port === 'number') {
        startEvent.port = server.port;
      }
      if (server.hostname) {
        startEvent.hostname = server.hostname;
      }
      mochiEvents.emit('server:start', startEvent);
    }

    // Validated above; mount the live queues now (after bind, so they drain on
    // the same shutdown path as the server). If a queue throws mid-mount, tear
    // the just-bound server down rather than leaving it listening half-started.
    try {
      for (const [name, config] of Object.entries(options.queues ?? {})) {
        createQueue(name, config.process, config.options, config.on);
      }
    } catch (err) {
      await closeAllQueueResources();
      await server.stop(true);
      throw err;
    }
    // Fired before recovery runs: by this point every queue in the map is
    // registered, so a recover() callback (or a user hook) reaching for a
    // sibling gets its handle rather than a "not mounted yet" error.
    await runHook('mochi:queuesMounted', { options, server, queues: Object.keys(options.queues ?? {}) });
    // After the whole map is mounted, so a recover() callback may reach a
    // sibling queue. Awaited, so recovered jobs are enqueued before
    // `mochi:ready` fires and before serve() resolves.
    await runQueueRecovery(Object.entries(options.queues ?? {}));

    if (warmupHandlers.length > 0) {
      mochiEvents.emit('warmup:start', { routeCount: warmupHandlers.length });
      const t0 = performance.now();
      // Warm sequentially: SSR is CPU-bound and serializes on the single
      // thread, so firing in parallel wouldn't render any faster — it would
      // only smear every route's `request` duration into the batch total and
      // thrash startup. One at a time keeps per-route timings honest.
      void (async () => {
        let errorCount = 0;
        for (const { pattern, handler } of warmupHandlers) {
          // Request the canonical path so the trailing-slash policy doesn't
          // redirect early instead of running the render we're warming.
          const url = new URL(`http://localhost${pattern}`);
          const redirect = trailingSlashPolicy ? trailingSlashRedirect('GET', url, trailingSlashPolicy) : null;
          const href = redirect ? new URL(redirect.headers.get('Location') ?? pattern, url).href : url.href;
          try {
            // The handler swallows render errors internally and returns a 5xx
            // error page, so a throw is rare — count 5xx as "didn't warm
            // cleanly" too. 4xx (e.g. an auth-gated route seeing the anonymous
            // warmup visitor) is expected, not a failure.
            const response = await handler(markWarmupRequest(new Request(href)), server);
            if (response.status >= 500) {
              errorCount += 1;
            }
          } catch {
            errorCount += 1;
          }
        }
        mochiEvents.emit('warmup:complete', {
          routeCount: warmupHandlers.length,
          errorCount,
          durationMs: performance.now() - t0,
        });
      })();
    }

    if (development) {
      await startDevWatcher({
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
        entryPath: Bun.main,
        apiHandlerMap,
        sseHandlerMap,
        wsHandlersMap,
        pageConfigMap,
        registerRoutePattern,
        unregisterRoutePattern,
        updateRouteLimiter,
        trailingSlashPolicy,
        shellPath,
        reloadShell,
        wrapPublicRoute: (route, value) => wrapRawRouteValue(route, value, 'asset'),
        runDevWebSocketUpgrade,
      });
    }

    Mochi.installShutdownHandlers(options, server, development);
    await runHook('mochi:ready', { options, server });

    return server;
  }

  /**
   * Install one-shot SIGTERM/SIGINT listeners that fire the `mochi:shutdown`
   * hook and stop the server. A second signal force-exits — same convention as
   * most CLIs. Listeners are added per `serve()` call, but `initMochiConfig`
   * already forbids more than one server per process.
   */
  private static installShutdownHandlers(options: MochiServeOptions, server: Server<undefined>, development: boolean): void {
    let shuttingDown = false;
    const handle = async (signal: NodeJS.Signals): Promise<void> => {
      if (shuttingDown) {
        process.exit(1);
      }
      shuttingDown = true;
      logger.info(`Received ${signal}, shutting down…`);
      try {
        await runHook('mochi:shutdown', { options, server, signal });
      } catch (err) {
        logger.error(`mochi:shutdown hook failed: ${err instanceof Error ? err.message : err}`);
      }
      await closeAllQueueResources();
      resetStartupMilestones();
      const stopEvent: MochiServerStopEvent = { reason: 'signal' };
      if (signal === 'SIGTERM' || signal === 'SIGINT') {
        stopEvent.signal = signal;
      }
      mochiEvents.emit('server:stop', stopEvent);

      // A non-forced stop() waits for every connection to drain, and Bun never
      // resolves it while a WebSocket is open — in dev, any browser tab holding
      // the live-reload socket wedges the process forever. So the graceful stop
      // only ever gets the grace period, then connections are cut regardless.
      const timeout = options.shutdownTimeout ?? (development ? 0 : 5_000);
      if (timeout > 0) {
        // Caught inline: once the grace period wins the race, a late rejection
        // from the graceful stop has no one left to await it.
        const graceful = server.stop().catch((err: unknown) => {
          logger.warn(`Graceful stop failed: ${err instanceof Error ? err.message : err}`);
        });
        await Promise.race([graceful, Bun.sleep(timeout)]);
      }
      await server.stop(true);
      // Exit explicitly: chokidar's dev watchers and any timer user code left
      // running would otherwise keep the event loop alive past the last socket.
      process.exit(0);
    };
    process.on('SIGTERM', handle);
    process.on('SIGINT', handle);
  }
}
