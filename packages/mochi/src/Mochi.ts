import type { Server, ServerWebSocket } from 'bun';
import { checkEnvironment } from './checkEnvironment';
import { existsSync, rmSync, mkdirSync } from 'fs';
import path from 'node:path';
import { ComponentRegistry, formatCompileErrors } from './ComponentRegistry';
import type { RenderResult } from './ComponentRegistry';
import { loadSvelteConfig } from './svelteConfig';
import { buildInlineWebComponent } from './buildInlineWebComponent';
import { buildClientStatsRoutes, CLIENT_STATS_COMPONENT } from './clientStatsRoutes';
import { isMochiPage, isMochiApi, isMochiWs, isMochiSse, isServerPropsResolver } from './types';
import type {
  BunRouteValue,
  HttpMethod,
  MochiApiConfig,
  MochiApiHandler,
  MochiPageConfig,
  MochiPageHandlerConfig,
  MochiFormActionResult,
  MochiFormActions,
  MochiRouteValue,
  MochiServerPropsResolver,
  MochiServeOptions,
  RouteRegistrationResult,
  MochiSseConfig,
  MochiSseHandler,
  MochiSseStream,
  MochiWsConfig,
  MochiWsHandlers,
  MochiWsData,
} from './types';
import { isFormFail, isFormRedirect, isFormSuccess } from './forms';
import { isEnhanceRequest, jsonError, jsonFailure, jsonRedirect, jsonSuccess } from './formsJson';
import { csrfCheck, DEFAULT_FORM_CONTENT_TYPES, DEFAULT_PROTECTED_METHODS } from './csrf';
import { applyFilter, initExtensions, runHook } from './extensions';
import { buildPublicUrl } from './proxy';
import { apiError, collectHeaderPairs, isHtmlResponse, MochiHttpError } from './utils';
import type { MochiEvent, MochiEventKind, MochiResolveOptions } from './hooks';
import { applyResolveOptions } from './hooks';
import { alternateSlashPattern, trailingSlashRedirect } from './trailingSlash';
import { createErrorResponder, DEFAULT_ERROR_PAGE_PATH } from './errors';
import { requestContext } from './requestContext';
import type { MochiRequestContext } from './requestContext';
import { finalizeCookieHeaders } from './cookies';
import { makeRequestContextBuilder } from './requestSetup';
import { verifyAndDecodeProps } from './serverIslandCrypto';
import { initMochiConfig } from './mochiConfig';
import { logger, setLogLevel, DEFAULT_LOG_LEVEL, type LogLevel } from './log';
import { mochiEvents } from './events';
import type { MochiActionResult, MochiErrorEvent, MochiErrorKind, MochiServerStartEvent, MochiServerStopEvent } from './events';
import { nanoid } from 'nanoid';
import type { DebugBarData, DebugBarRuntimeData } from './requestContext';
import { consoleLogger } from './consoleLogger';
import { parse as devalueParse, stringify as devalueStringify } from 'devalue';
import { ISLAND_FAILURE_CSS, ISLAND_FAILURE_DEV_CSS, islandFailureStub } from './web-components/islandFailureStub';
import { scanPublicDir } from './publicDir';
import { startDevWatcher } from './devWatcher';
import { buildPageCacheAdminRoutes, PAGE_CACHE_ADMIN_COMPONENT } from './pageCacheAdminRoutes';

const DEFAULT_HTML_SHELL = await Bun.file(new URL('./templates/default-shell.html', import.meta.url)).text();

/**
 * Dev-only: append a trailing `<script>` after the response body that mixes
 * the current request's response headers and inbound cookies into
 * `window.__mochi_debug`. The static fields (route, params, islandProps, …)
 * are baked into the body in `resolveHtmlShell` and cached with it; the
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
    headers: collectHeaderPairs(response.headers),
    requestCookies: ctx.cookies.peekAll().map(({ name, value }) => [name, value]),
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
    },
  ): MochiPageConfig {
    return {
      __mochiPage: true,
      componentPath,
      serverProps: config?.serverProps,
      actions: config?.actions,
    };
  }

  static api(handler: MochiApiHandler): MochiApiConfig {
    return { __mochiApi: true, handler };
  }

  static ws<T = unknown>(handlers: MochiWsHandlers<T>): MochiWsConfig {
    return {
      __mochiWs: true,
      handlers: handlers as MochiWsHandlers<unknown>,
    };
  }

  static sse(handler: MochiSseHandler): MochiSseConfig {
    return { __mochiSse: true, handler };
  }

  private static resolveHtmlShell(
    template: string,
    result: RenderResult,
    registry: ComponentRegistry,
    opts: {
      serverIslandClientJs: string;
      liveReloadClientJs: string;
      debugBarUrl?: string | null;
      debugInfo?: DebugBarData;
      logLevel: LogLevel;
      /**
       * Absolute path of the page entry that rendered this HTML. Inlined as
       * `window.__mochi_page_entry` when live-reload is enabled so the WS can
       * scope `reload` signals to tabs whose entry was actually affected by a
       * change. Omitted when live-reload is off.
       */
      pageEntry?: string;
    },
  ): string {
    const bootstrapUrl = result.bootstrapUrl;
    const cssLinks = result.cssUrls.map((url) => `<link rel="stylesheet" href="${url}">`).join('\n');
    const serverIslandScript = result.hasServerIslands ? `<script>(()=>{${opts.serverIslandClientJs}})()</script>` : '';
    const debugInfoScript = registry.debugBarEnabled && opts.debugInfo ? `<script>window.__mochi_debug=${jsonForHtml(opts.debugInfo)}</script>` : '';
    const pageEntryScript = opts.liveReloadClientJs && opts.pageEntry ? `<script>window.__mochi_page_entry=${jsonForHtml(opts.pageEntry)}</script>` : '';
    const logLevelScript = opts.logLevel === DEFAULT_LOG_LEVEL ? '' : `<script>window.__mochi_log_level=${JSON.stringify(opts.logLevel)}</script>`;
    // Feeds the debug bar's Warnings panel. When the debug bar is off the
    // single `window.__mochi_warn?.(...)` call site no-ops via optional chaining.
    const warnShim = registry.debugBarEnabled
      ? `<script>window.__mochi_warnings=[];window.__mochi_warn=function(m){console.warn("[mochi] "+m);window.__mochi_warnings.push(m)}</script>`
      : '';
    // Use function-form replacements: string-form `.replace` interprets `$&`,
    // `$'`, `` $` ``, `$$` in the replacement as special patterns. Minified JS
    // and user-serialized props can legitimately contain those sequences.
    return template
      .replace('{{mochi.head}}', () => logLevelScript + warnShim + result.head)
      .replace(
        '{{mochi.css}}',
        () =>
          `<style>mochi-hydratable-island, mochi-server-island { display: contents; } mochi-server-island[defer-on="visible"]:empty { display: block; min-height: 1px; }${ISLAND_FAILURE_CSS}${
            registry.development ? ISLAND_FAILURE_DEV_CSS : ''
          }</style>\n${cssLinks}`,
      )
      .replace('{{mochi.body}}', () => result.body + debugInfoScript + pageEntryScript + (registry.debugBarEnabled ? '<div id="mochi-dev-toolbar"></div>' : ''))
      .replace(
        '{{mochi.script}}',
        () =>
          (bootstrapUrl ? `<script type="module" src="${bootstrapUrl}"></script>` : '') +
          serverIslandScript +
          (opts.debugBarUrl
            ? `<script type="module" src="${opts.debugBarUrl}"></script><script>window.__mochi_asset_prefix=${JSON.stringify(registry.assetPrefix)}</script>`
            : '') +
          (opts.liveReloadClientJs ? `<script>${opts.liveReloadClientJs}</script><mochi-live-reload></mochi-live-reload>` : ''),
      );
  }

  static async serve(options: MochiServeOptions): Promise<Server<undefined>> {
    await checkEnvironment();
    initExtensions(options);
    await runHook('mochi:init', { options });
    await initMochiConfig(options);

    // Resolve filterable defaults once at startup; the resolved Sets are
    // captured in the per-request closures below. A fresh copy of each
    // default Set is passed to the user so accidental in-place mutation
    // can't poison the framework default for the next call.
    const formContentTypes: ReadonlySet<string> = applyFilter('csrf:formContentTypes', new Set(DEFAULT_FORM_CONTENT_TYPES), { options });
    const protectedMethods: ReadonlySet<string> = applyFilter('csrf:protectedMethods', new Set(DEFAULT_PROTECTED_METHODS), { options });
    const trustedOrigins: ReadonlySet<string> = applyFilter('csrf:trustedOrigins', new Set(options.csrf?.trustedOrigins ?? []), { options });
    const cookieDefaults = applyFilter('cookie:defaults', {}, { options });

    const development = options.development ?? true;
    const debugBarEnabled = development && (options.debugBar ?? true);
    const liveReloadEnabled = options.liveReload ?? development;
    const middleware = options.handle;
    const outDir = options.outDir ?? './.mochi';
    const publicDir = options.publicDir ?? './public';
    const watchPaths = Array.from(new Set(['src', 'public', ...(options.additionalWatchPaths ?? [])]));

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
      return nanoid(32);
    };

    const { enabled: loggerEnabled = true, level: configuredLevel, ...loggerOptions } = options.logger ?? {};
    const resolvedLogLevel: LogLevel = configuredLevel ?? (development ? 'info' : DEFAULT_LOG_LEVEL);
    setLogLevel(resolvedLogLevel);
    if (loggerEnabled) {
      consoleLogger(loggerOptions);
    }

    logger.info(`Starting in ${development ? 'development' : 'production'} mode`);

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
        markdown: options.markdown,
      });
      if (development) {
        for (const dir of [`${outDir}/svelte-client`, `${outDir}/svelte-compile`, `${outDir}/svelte-css`]) {
          rmSync(dir, { recursive: true, force: true });
          mkdirSync(dir, { recursive: true });
        }
      }
    }

    let shellTemplate: string;
    if (options.htmlShell) {
      shellTemplate = options.htmlShell.endsWith('.html') ? await Bun.file(options.htmlShell).text() : options.htmlShell;
    } else {
      shellTemplate = DEFAULT_HTML_SHELL;
    }
    shellTemplate = applyFilter('html:shell', shellTemplate, { options, development });

    const errorPagePath = options.errorPage ?? DEFAULT_ERROR_PAGE_PATH;

    // Collect every page entrypoint (error page + every Mochi.page route) so
    // we can compile them in one Bun.build below. Splitting deduplicates
    // shared transitive deps (devalue, mochi-framework internals, etc.) into
    // chunk files instead of inlining them per page; collapsing
    // the boot-time pre-compiles into one Bun.build also dodges the
    // documented EISDIR bug that fires when two `Bun.build` calls in the
    // same process touch the same transitive deps.
    const ssrEntrypoints: string[] = [errorPagePath, CLIENT_STATS_COMPONENT];
    if (debugBarEnabled) {
      ssrEntrypoints.push(PAGE_CACHE_ADMIN_COMPONENT);
    }
    if (options.routes) {
      for (const handler of Object.values(options.routes)) {
        if (isMochiPage(handler)) {
          ssrEntrypoints.push(handler.componentPath);
        }
      }
    }
    await registry.compileAll(ssrEntrypoints);

    const serverIslandClientJs = await buildInlineWebComponent('./web-components/ServerIsland.ts');
    const liveReloadClientJs = liveReloadEnabled ? await buildInlineWebComponent('./web-components/LiveReload.ts') : '';

    const { renderErrorResponse, routeErrorResponse } = createErrorResponder({
      handleError: options.handleError,
      development,
      registry,
      errorPagePath,
      renderShell: (result) =>
        Mochi.resolveHtmlShell(shellTemplate, result, registry, {
          serverIslandClientJs,
          liveReloadClientJs,
          debugBarUrl: registry.getDebugBarUrl(),
          logLevel: resolvedLogLevel,
        }),
    });

    // Run the user's handleError hook (if configured), sanitize the error for
    // the enhanced JSON path, and return a jsonError envelope. Mirrors the
    // handleError logic in renderErrorResponse but skips the HTML render.
    const handleEnhancedError = async (err: unknown, event: MochiEvent): Promise<Response> => {
      let status = err instanceof MochiHttpError ? err.status : 500;
      let message = err instanceof Error ? err.message : 'Internal Error';
      if (options.handleError) {
        try {
          const override = await options.handleError({ error: err, event, status, message });
          if (override instanceof Response) {
            return override;
          }
          if (override && typeof override === 'object' && typeof (override as { status?: unknown }).status === 'number') {
            status = (override as { status: number }).status;
            message = (override as { message: string }).message;
          }
        } catch (hookErr) {
          logger.error('handleError hook threw:', hookErr);
        }
      }
      return jsonError(status, message);
    };

    // Pre-compile Mochi.page() handlers so SSR is ready at startup
    const mochiPageMap = new Map<string, MochiPageConfig>();
    const wsHandlersMap = new Map<string, MochiWsHandlers<unknown>>();
    let resolvedRouteModule = options.routeModule;
    if (development && !resolvedRouteModule) {
      for (const candidate of ['./src/routes.ts', './src/routes.js']) {
        if (existsSync(candidate)) {
          resolvedRouteModule = candidate;
          break;
        }
      }
    }
    const routeHmr = development && !!resolvedRouteModule;
    const apiHandlerMap = routeHmr ? new Map<string, MochiApiHandler>() : undefined;
    const sseHandlerMap = routeHmr ? new Map<string, MochiSseHandler>() : undefined;
    const pageConfigMap = routeHmr ? new Map<string, MochiPageHandlerConfig>() : undefined;
    const bunRoutes: Record<string, BunRouteValue> = {};
    const routeCounts = { page: 0, api: 0, ws: 0, sse: 0 };
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

    const internalRoutes: Record<string, MochiPageConfig | MochiApiConfig> = {
      ...buildClientStatsRoutes(registry),
      ...(debugBarEnabled ? buildPageCacheAdminRoutes() : {}),
    };
    const allRoutes = Object.keys(internalRoutes).length > 0 ? { ...internalRoutes, ...(options.routes ?? {}) } : options.routes;

    async function registerRoutePattern(pattern: string, handler: MochiRouteValue): Promise<RouteRegistrationResult | null> {
      if (isMochiPage(handler)) {
        mochiPageMap.set(pattern, handler);
        const { componentPath, serverProps, actions } = handler;
        if (pageConfigMap) {
          pageConfigMap.set(pattern, { serverProps, actions });
        }
        await registry.compile(componentPath);

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
          const html = Mochi.resolveHtmlShell(shellTemplate, result, registry, {
            serverIslandClientJs,
            liveReloadClientJs,
            debugBarUrl: registry.getDebugBarUrl(),
            debugInfo: result.debugBarData ? { ...result.debugBarData, liveReloadEnabled } : undefined,
            logLevel: resolvedLogLevel,
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
          });
          if ('earlyResponse' in setup) {
            return setup.earlyResponse;
          }
          const { ctx, start, requestId, url, params } = setup;
          const event: MochiEvent = { request: req, url, server, locals: ctx.locals, kind: 'page' };

          return requestContext.run(ctx, async () => {
            runHook('route:matched', { pattern, request: req, url, params, kind: 'page' });
            const innerResolve = async (_event: MochiEvent, resolveOpts?: MochiResolveOptions): Promise<Response> => inner(ctx, event, resolveOpts);

            const response = middleware ? await middleware({ event, resolve: innerResolve }) : await innerResolve(event);

            const final = finalizeCookieHeaders(response, ctx.cookies);
            const shipped = await appendDebugTail(final, ctx, development);
            mochiEvents.emit('request', {
              requestId,
              kind: 'page',
              method: req.method,
              path: url.pathname + url.search,
              status: shipped.status,
              duration: performance.now() - start,
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

        // In HMR mode (pageConfigMap set), register POST for all pages so actions
        // can be added via hot-swap without restart. Returns 405 if none exist.
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
            bunRouteValue: {
              GET: getHandler,
              POST: postHandler,
            } as unknown as BunRouteValue,
            type: 'page',
          };
        }
        return { bunRouteValue: getHandler, type: 'page' };
      } else if (isMochiApi(handler)) {
        if (apiHandlerMap) {
          apiHandlerMap.set(pattern, handler.handler);
        }
        const capturedApiHandler = handler.handler;

        const bunRouteValue: BunRouteValue = async (req: Request, server: Server<undefined>): Promise<Response> => {
          const setup = buildRequestContext(req, server, { kind: 'api', pattern });
          if ('earlyResponse' in setup) {
            return setup.earlyResponse;
          }
          const { ctx, start, requestId, url, params } = setup;

          return requestContext.run(ctx, async () => {
            runHook('route:matched', { pattern, request: req, url, params, kind: 'api' });
            const innerResolve = async (event: MochiEvent, resolveOpts?: MochiResolveOptions): Promise<Response> => {
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

            const event: MochiEvent = { request: req, url, server, locals: ctx.locals, kind: 'api' };
            const response = middleware ? await middleware({ event, resolve: innerResolve }) : await innerResolve(event);

            const final = finalizeCookieHeaders(response, ctx.cookies);
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
        return { bunRouteValue, type: 'api' };
      } else if (isMochiWs(handler)) {
        const wsHandlers = handler.handlers;
        wsHandlersMap.set(pattern, wsHandlers);

        const bunRouteValue = (async (req: Request, server: Server<undefined>) => {
          const setup = buildRequestContext(req, server, { kind: 'ws', pattern });
          if ('earlyResponse' in setup) {
            return setup.earlyResponse;
          }
          const { ctx: wsHookCtx, start, url: wsUrl, params: wsParams } = setup;
          requestContext.run(wsHookCtx, () => {
            runHook('route:matched', {
              pattern,
              request: req,
              url: wsUrl,
              params: wsParams,
              kind: 'ws',
            });
          });
          let userData: unknown = undefined;

          const liveWsHandlers = wsHandlersMap.get(pattern) ?? wsHandlers;
          if (liveWsHandlers.upgrade) {
            const result = await liveWsHandlers.upgrade(req, wsParams);
            if (result === false) {
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
          ).upgrade(req, {
            data: {
              __mochiRoutePattern: pattern,
              __mochiOpenedAt: performance.now(),
              __mochiPath: wsUrl.pathname + wsUrl.search,
              user: userData,
            } satisfies MochiWsData,
          });

          if (!success) {
            return new Response('WebSocket upgrade failed', { status: 500 });
          }
          mochiEvents.emit('ws:open', {
            path: wsUrl.pathname + wsUrl.search,
            duration: performance.now() - start,
          });
          return undefined;
        }) as unknown as BunRouteValue;
        return { bunRouteValue, type: 'ws' };
      } else if (isMochiSse(handler)) {
        if (sseHandlerMap) {
          sseHandlerMap.set(pattern, handler.handler);
        }
        const capturedSseHandler = handler.handler;

        const bunRouteValue: BunRouteValue = async (req: Request, server: Server<undefined>): Promise<Response> => {
          const setup = buildRequestContext(req, server, { kind: 'sse', pattern });
          if ('earlyResponse' in setup) {
            return setup.earlyResponse;
          }
          const { ctx: sseHookCtx, url, params: sseParams } = setup;
          const path = url.pathname + url.search;
          requestContext.run(sseHookCtx, () => {
            runHook('route:matched', {
              pattern,
              request: req,
              url,
              params: sseParams,
              kind: 'sse',
            });
          });
          let closed = false;
          let openedAt = 0;
          const emitClose = () => {
            if (closed) {
              return;
            }
            closed = true;
            mochiEvents.emit('sse:close', {
              path,
              duration: performance.now() - openedAt,
            });
          };

          let closeCallbacks: Array<() => void> = [];
          let controller: ReadableStreamDefaultController<string>;

          const body = new ReadableStream<string>({
            start(ctrl) {
              controller = ctrl;
              openedAt = performance.now();
              mochiEvents.emit('sse:open', { path });
              const stream: MochiSseStream = {
                send(data, opts) {
                  let frame = '';
                  if (opts?.id) {
                    frame += `id: ${opts.id}\n`;
                  }
                  if (opts?.event) {
                    frame += `event: ${opts.event}\n`;
                  }
                  for (const line of data.split('\n')) {
                    frame += `data: ${line}\n`;
                  }
                  frame += '\n';
                  controller.enqueue(frame);
                  mochiEvents.emit('sse:message', {
                    path,
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
              liveSseHandler(stream, req);
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
        return { bunRouteValue, type: 'sse' };
      }
      return null;
    }

    function unregisterRoutePattern(pattern: string): void {
      mochiPageMap.delete(pattern);
      apiHandlerMap?.delete(pattern);
      sseHandlerMap?.delete(pattern);
      wsHandlersMap?.delete(pattern);
      pageConfigMap?.delete(pattern);
    }

    if (allRoutes) {
      for (const [pattern, handler] of Object.entries(allRoutes)) {
        const result = await registerRoutePattern(pattern, handler);
        if (result) {
          bunRoutes[pattern] = result.bunRouteValue;
          routeCounts[result.type] += 1;
        } else {
          bunRoutes[pattern] = handler as BunRouteValue;
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
    bunRoutes[`${registry.assetPrefix}/island/:componentName`] = async (req: Request, server: Server<undefined>): Promise<Response> => {
      const setup = buildRequestContext(req, server, {
        kind: 'island',
        pattern: `${registry.assetPrefix}/island/:componentName`,
        paramsOverride: {},
      });
      if ('earlyResponse' in setup) {
        return setup.earlyResponse;
      }
      const { ctx, url, params } = setup;
      const componentName = params.componentName;
      if (!componentName) {
        return new Response('Missing component name', { status: 400 });
      }

      const signedProps = url.searchParams.get('props') ?? '';
      const hydrateMode = url.searchParams.get('hydrate');

      // Verify signature and decode props (empty means no props)
      let props: Record<string, unknown>;
      if (signedProps) {
        const propsJson = verifyAndDecodeProps(signedProps);
        if (propsJson === null) {
          return new Response('Invalid props signature', { status: 403 });
        }
        props = devalueParse(propsJson) as Record<string, unknown>;
      } else {
        props = {};
      }

      // Look up the component path
      const componentPath = registry.getServerIslandPath(componentName);
      if (!componentPath) {
        return new Response('Unknown server island component', { status: 404 });
      }

      return requestContext.run(ctx, async () => {
        // Compile the server island component directly
        await registry.compile(componentPath);
        let result: RenderResult;
        try {
          result = await registry.renderComponent(componentPath, props as Record<string, unknown>, {
            stripMarkers: false,
          });
        } catch (err) {
          const e = err instanceof Error ? err : new Error(String(err));
          logger.error(`Server island "${componentName}" failed: ${e.message}`);
          mochiEvents.emit('island:error', {
            componentName,
            islandId: (props as Record<string, unknown>).islandId as string | undefined,
            kind: 'server',
            message: e.message,
            stack: registry.development ? e.stack : undefined,
          });
          // 200 + a known stub so `ServerIsland.ts` doesn't burn its retry budget
          // on a deterministic failure. Visibility is CSS-controlled: dev shows
          // the message, prod hides the element entirely.
          const stub = islandFailureStub(componentName, registry.development ? e.message : undefined);
          return new Response(stub, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'private, no-store',
            },
          });
        }

        let body = result.body;

        // If also-hydrate is requested, wrap in hydratable island
        if (hydrateMode === 'eager' || hydrateMode === 'visible') {
          const componentUrl = registry.getComponentEntryUrl(componentName);
          const serializedProps = devalueStringify(props);
          const bootstrapUrl = registry.getIslandBootstrapUrl();

          const islandId = props.islandId as string | undefined;
          if (!islandId) {
            logger.warn(`Server island "${componentName}" missing islandId in props`);
          }
          let hydrateAttrs = `component-name="${componentName}"`;
          if (islandId) {
            hydrateAttrs += ` island-id="${islandId}"`;
          }
          if (Object.keys(props as Record<string, unknown>).length > 0) {
            const escapedProps = serializedProps.replace(/"/g, '&quot;');
            hydrateAttrs += ` props="${escapedProps}"`;
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

        return new Response(body, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'private, no-store',
          },
        });
      });
    };

    if (process.env.MOCHI_MEMORY_PROBE === '1') {
      bunRoutes['/__mochi/health/memory'] = (): Response => {
        Bun.gc(true);
        return Response.json({
          timestamp: Date.now(),
          memory: process.memoryUsage(),
        });
      };
    }

    // Snapshot the non-public route set so the dev-mode public watcher can
    // rebuild cleanly when files are added/removed/renamed.
    const baseBunRoutes: Record<string, BunRouteValue> = { ...bunRoutes };

    // Register static public files. Dev mode reads from `./public` directly;
    // production reads the prebuilt map from the manifest. User-defined routes
    // always win — we only add a public route when no user route claims the path.
    // A fresh Map is passed to the `publicDir:scan` filter so user mutation
    // can't poison the registry's copy in production.
    const scannedPublicFiles = development ? await scanPublicDir(publicDir) : new Map(registry.getPublicFiles());
    const initialPublicFiles = await applyFilter('publicDir:scan', scannedPublicFiles, {
      publicDir,
      development,
    });
    for (const [urlPath, diskPath] of initialPublicFiles) {
      if (!(urlPath in bunRoutes)) {
        bunRoutes[urlPath] = Bun.file(diskPath);
      } else {
        logger.warn(`Public file "${diskPath}" skipped: URL "${urlPath}" is already registered as a route.`);
      }
    }

    const userFetch = options.fetch;

    const composedFetch = async (req: Request, server: Server<undefined>): Promise<Response> => {
      const url = buildPublicUrl(req, options.proxy);
      if (trailingSlashPolicy) {
        const redirect = trailingSlashRedirect(req.method, url, trailingSlashPolicy);
        if (redirect) {
          return redirect;
        }
      }
      const csrfResponse = csrfCheck(req, url, options.csrf, options.proxy, development, formContentTypes, protectedMethods, trustedOrigins);
      if (csrfResponse) {
        return csrfResponse;
      }

      // For non-route requests that go through fetch, also run middleware.
      // Static-asset paths (`/_mochi/client/...` bundles) flow through the
      // same chain so a user `gzip()` middleware compresses them like any
      // other response. Kind is precomputed so middleware can branch (e.g.
      // skip auth for assets).
      const assetContent = registry.getClientFile(url.pathname);
      const kind: MochiEventKind = assetContent !== undefined ? 'asset' : userFetch ? 'fallback' : 'error';

      const event: MochiEvent = { request: req, url, server, locals: {}, kind };

      // `_event` is unused — `MochiResolveFn`'s signature requires it for parity
      // with route resolvers, but `url`, `req`, and `assetContent` are already
      // fixed in the enclosing scope, so we read those instead.
      const innerResolve = async (_event: MochiEvent, resolveOpts?: MochiResolveOptions): Promise<Response> => {
        if (assetContent !== undefined) {
          // getClientFile() only returns registered .js or .css; determine type
          // by extension so this branch doesn't depend on the asset prefix.
          const contentType = url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript';
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
          const response = await userFetch(req, server);
          return applyResolveOptions(response, resolveOpts);
        }
        return renderErrorResponse({
          req,
          event,
          resolveOpts,
          status: 404,
          message: 'Not Found',
          thrown: null,
        });
      };

      const start = performance.now();
      const requestId = newRequestId(req);
      const response = await (middleware ? middleware({ event, resolve: innerResolve }) : innerResolve(event));
      mochiEvents.emit('request', {
        requestId,
        kind,
        method: req.method,
        path: url.pathname + url.search,
        status: response.status,
        duration: performance.now() - start,
      });
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
    if (liveReloadEnabled) {
      wsHandlersMap.set('/__mochi_live_reload', {
        open(ws) {
          liveReloadClients.add(ws as ServerWebSocket<MochiWsData>);
        },
        message() {},
        close(ws) {
          liveReloadClients.delete(ws as ServerWebSocket<MochiWsData>);
        },
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

    const server = Bun.serve({
      ...bunOptions,
      routes: bunRoutes,
      fetch: composedFetch,
      ...(websocketOption ? { websocket: websocketOption } : {}),
    } as Parameters<typeof Bun.serve>[0]);

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

    if (development) {
      startDevWatcher({
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
        routeModule: resolvedRouteModule,
        apiHandlerMap,
        sseHandlerMap,
        wsHandlersMap,
        pageConfigMap,
        registerRoutePattern: routeHmr ? registerRoutePattern : undefined,
        unregisterRoutePattern: routeHmr ? unregisterRoutePattern : undefined,
        trailingSlashPolicy,
      });
    }

    Mochi.installShutdownHandlers(options, server);
    await runHook('mochi:ready', { options, server });

    return server;
  }

  /**
   * Install one-shot SIGTERM/SIGINT listeners that fire the `mochi:shutdown`
   * hook and stop the server. A second signal force-exits — same convention as
   * most CLIs. Listeners are added per `serve()` call, but `initMochiConfig`
   * already forbids more than one server per process.
   */
  private static installShutdownHandlers(options: MochiServeOptions, server: Server<undefined>): void {
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
      const stopEvent: MochiServerStopEvent = { reason: 'signal' };
      if (signal === 'SIGTERM' || signal === 'SIGINT') {
        stopEvent.signal = signal;
      }
      mochiEvents.emit('server:stop', stopEvent);
      server.stop();
    };
    process.on('SIGTERM', handle);
    process.on('SIGINT', handle);
  }
}
