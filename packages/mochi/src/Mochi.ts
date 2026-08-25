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
import {
  isMochiPage,
  isMochiApi,
  isMochiWs,
  isMochiSse,
  isMochiFile,
  isMochiCron,
  isMochiQueue,
  isServerPropsResolver,
  isAlsoHydrateMode,
  ALSO_HYDRATE_ENVELOPE_KEY,
  FRAMEWORK_OWNED_BUN_KEYS,
} from './types';
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
  MochiWorkerOptions,
  RouteRegistrationResult,
  MochiSseConfig,
  MochiSseHandler,
  MochiSseStream,
  MochiWsConfig,
  MochiWsHandlers,
  MochiWsData,
} from './types';
import { isFormFail, isFormSuccess, isRedirect } from './runtime/forms';
import { isEnhanceRequest, jsonError, jsonFailure, jsonRedirect, jsonSuccess } from './runtime/formsJson';
import { csrfCheck, csrfBootWarning, DEFAULT_FORM_CONTENT_TYPES, DEFAULT_PROTECTED_METHODS } from './runtime/csrf';
import { applyFilter, initExtensions, runHook } from './extensions';
import { escapeHtmlAttr } from './utils/htmlEscape';
import { buildPublicUrl } from './runtime/proxy';
import { realpath } from 'node:fs/promises';
import {
  apiError,
  collectHeaderPairs,
  cssLinkTag,
  FONT_PRELOAD_MAX,
  fontPreloadTag,
  headResponse,
  isHtmlResponse,
  MochiHttpError,
  normalizeAssetPrefix,
  relForDisplay,
  toPosixPath,
  withHead,
} from './utils';
import { serveDiskAsset } from './utils/serveDiskAsset';
import type { MochiEvent, MochiEventKind, MochiResolveOptions } from './runtime/hooks';
import { applyResolveOptions, sequence } from './runtime/hooks';
import { setupWuchaleI18n, type MochiI18nWatchHook } from './i18n/wuchale';
import { alternateSlashPattern, trailingSlashRedirect } from './runtime/trailingSlash';
import { resolveWarmupEnabled, markWarmupRequest, isWarmablePattern } from './runtime/warmup';
import { createErrorResponder, DEFAULT_ERROR_PAGE_PATH } from './runtime/errors';
import { requestContext } from './runtime/requestContext';
import type { MochiRequestContext } from './runtime/requestContext';
import type { SpeculationRules } from './runtime/speculationRules';
import {
  startQueueRuntime,
  mountQueues,
  getQueue,
  getBoss,
  closeAllQueueResources,
  isValidQueueStorage,
  createQueueDescriptor,
  createWorker,
  storageEquals,
  assertNoConflictingStandaloneRuntime,
  resolveQueueConfigMode,
  collectQueueClosure,
  startCronRuntime,
  stopCronRuntime,
  CRON_JITTER_MS,
} from './queue';
import { pinGlobal } from './utils/globalState';
import { resetStartupMilestones } from './lifecycle';
import type { MochiQueue, MochiQueueOptions, MochiQueueDescriptor, MochiQueueStorage, MochiWorker } from './queue';
import type { BunBoss } from 'bun-boss';
import { finalizeCookieHeaders, MochiCookieJar } from './runtime/cookies';
import { makeRequestContextBuilder, mirrorsSlashForm } from './runtime/requestSetup';
import { createRouteLimiter, applyRateLimitHeaders } from './runtime/rateLimit';
import type { MochiRateLimitOptions, MochiRateLimitStore, RouteLimiter } from './runtime/rateLimit';
import { decryptProps } from './islands/serverIslandCrypto';
import { DEFAULT_INLINE_BUDGET } from './islands/inlineServerIslands';
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
import { installMemoryPressureHandler, removeMemoryPressureHandler } from './runtime/memoryPressure';
import { registerStaticDirRoutes, resolveStaticDirs } from './runtime/staticDirs';
import { createCronJob, cronSignature, type MochiCronHandler, type MochiCronJob, type MochiCronOptions } from './cron';
import { startDevWatcher } from './dev/devWatcher';
import { buildPageCacheAdminRoutes, PAGE_CACHE_ADMIN_COMPONENT } from './dev/pageCacheAdminRoutes';
import { liveReloadGreeting } from './dev/liveReloadGeneration';
import { createProtectionRuntime } from './protection/gate';
import { resolveProtectionOptions, PROTECTION_SHELL_COMPONENT } from './protection/config';
import { mintClearanceToken } from './protection/clearance';
import { verifyCaptcha } from './captcha/captcha';
import { getCaptchaRuntime } from './captcha/config';

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

// Parsing once per template turns per-request filling into a walk over these parts instead of a global-regex scan.
// Splitting the template rather than the assembled output also keeps an injected body containing a literal
// `{{mochi.script}}` from being re-expanded.
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

// Escaping `<` keeps a `</script>` inside the payload from closing the tag early.
function jsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * `createShellRenderer` bakes the static `window.__mochi_debug` fields into the cached body, so per-request headers and cookies have to be appended
 * afterwards for cache hits to stay accurate. The trailing script is synchronous so it lands before the deferred debug-bar module runs `onMount`.
 */
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

  static ws<T = unknown>(handlers: MochiWsHandlers<T>): MochiWsConfig {
    return {
      __mochiWs: true,
      handlers: handlers as MochiWsHandlers<unknown>,
    };
  }

  static sse(handler: MochiSseHandler): MochiSseConfig {
    return { __mochiSse: true, handler };
  }

  static file(source: string | MochiFileResolver): MochiFileConfig {
    return { __mochiFile: true, source };
  }

  /**
   * Declare a background job queue. The returned descriptor is both the declaration `Mochi.serve({ queues: [q] })`
   * mounts (workers start there, and the queue drains gracefully on shutdown) and a directly-usable producer handle:
   * `q.add(...)` works anywhere. In a process that never serves, give it `storage` and the first add lazily connects a
   * producer-only runtime — no server, no workers; tear down with `Mochi.stop()`.
   */
  static queue<T = unknown, R = unknown>(name: string, config: MochiQueueOptions<T, R> = {}): MochiQueueDescriptor<T, R> {
    return createQueueDescriptor<T, R>(name, config);
  }

  /**
   * Declare a scheduled job — inert until `Mochi.serve({ cron: [job] })` starts it. Invalid schedules throw here at
   * import time, not at boot.
   */
  static cron(name: string, schedule: string, config: MochiCronOptions | MochiCronHandler): MochiCronJob {
    return createCronJob(name, schedule, config);
  }

  /**
   * Resolve the handle for a queue declared in `Mochi.serve({ queues })` so jobs can be `.add()`ed to it, passing the
   * payload type explicitly (`Mochi.getQueue<JobData>(name)`). Throws for an undeclared name, or before `Mochi.serve()` mounts its queues.
   */
  static getQueue<T = unknown>(name: string): MochiQueue<T> {
    return getQueue<T>(name);
  }

  /**
   * Declare a standalone worker: consume queues in a process that never calls `Mochi.serve()`. `start()` connects to
   * the app's queue storage (from the descriptors or the `storage` option), creates-or-verifies the declared queue
   * config (code is authoritative — see `queueConfig`), and begins polling. No hooks or milestones fire, and signal
   * handling is yours to wire (`Mochi.stop()` drains and closes the runtime).
   */
  static worker(options: MochiWorkerOptions): MochiWorker {
    return createWorker(options.queues, options.storage, options.queueConfig, options.queueShutdownTimeout);
  }

  /**
   * The shared bun-boss instance behind `Mochi.serve({ queues })` — the escape hatch for everything Mochi doesn't wrap:
   * `fetch`, `cancel`, `retry`, `redrive`, `findJobs`, `getQueueStats`, …. Available from the `mochi:queuesMounted` hook
   * onwards; throws before that, or when no queues are declared.
   */
  static boss(): BunBoss {
    return getBoss();
  }

  /**
   * Send a transactional email, configured under `Mochi.serve({ email })`. The body is `html`, `text`, or a Svelte
   * `component` rendered to HTML with its scoped CSS inlined. Callable from any server-side code — route actions,
   * API handlers, or queue jobs.
   */
  static email(message: MochiEmailMessage): Promise<MochiEmailResult> {
    return sendEmail(message);
  }

  /**
   * Computes every request-invariant shell fragment (log shim, warn shim, island `<style>` prefix, server-island runtime
   * wrapper, live-reload tail, asset prefix) once at startup, leaving each request to concatenate only the dynamic parts.
   */
  private static createShellRenderer(
    registry: ComponentRegistry,
    config: {
      serverIslandClientJs: string;
      liveReloadClientJs: string;
      logLevel: LogLevel;
      /** Reads the current shell template (reassigned on dev shell edits). */
      getTemplate: () => string;
      /** Reads the current speculation rules (reassigned on dev entry edits). */
      getSpeculationRules: () => SpeculationRules | undefined;
      fontPreload: boolean;
    },
  ): (result: RenderResult, opts?: { debugInfo?: DebugBarData; pageEntry?: string }) => string {
    const { serverIslandClientJs, liveReloadClientJs, logLevel, getTemplate, getSpeculationRules, fontPreload } = config;

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

    // Same deal for the speculation-rules payload: serialize once, re-serialize only when a dev entry edit swaps the object.
    let specRulesFrom: SpeculationRules | undefined | null = null;
    let speculationRulesScript = '';

    return (result, opts) => {
      const template = getTemplate();
      if (template !== parsedFrom) {
        parts = parseShellTemplate(template);
        parsedFrom = template;
      }

      const specRules = getSpeculationRules();
      if (specRules !== specRulesFrom) {
        specRulesFrom = specRules;
        const count = (specRules?.prefetch?.length ?? 0) + (specRules?.prerender?.length ?? 0);
        speculationRulesScript = count > 0 ? `<script type="speculationrules">${jsonForHtml(specRules)}</script>` : '';
      }

      const bootstrapUrl = result.bootstrapUrl;
      // Preloads go ahead of the stylesheet links: the fonts are otherwise discovered only after the CSS arrives.
      const fontPreloads = fontPreload ? result.fontPreloadUrls.slice(0, FONT_PRELOAD_MAX).map(fontPreloadTag).join('\n') : '';
      const cssLinks = (fontPreloads ? `${fontPreloads}\n` : '') + result.cssUrls.map(cssLinkTag).join('\n');
      const debugBarUrl = registry.getDebugBarUrl();
      const debugInfoScript = registry.debugBarEnabled && opts?.debugInfo ? `<script>window.__mochi_debug=${jsonForHtml(opts.debugInfo)}</script>` : '';
      const pageEntryScript = liveReloadClientJs && opts?.pageEntry ? `<script>window.__mochi_page_entry=${jsonForHtml(opts.pageEntry)}</script>` : '';

      const head = logLevelScript + warnShim + speculationRulesScript + result.head;
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
    // Reject before initMochiConfig pins the process singleton, so a bad `bun` passthrough fails fast without wedging it.
    if (options.bun && typeof options.bun === 'object') {
      for (const key of FRAMEWORK_OWNED_BUN_KEYS) {
        if (key in options.bun) {
          throw new Error(`Mochi.serve({ bun }): "${key}" is owned by the framework and cannot be overridden. Use the top-level Mochi.serve() option instead.`);
        }
      }
    }

    // Same fail-fast rule for the queue declarations: a bad descriptor, duplicate name, deadLetter, or storage shape rejects here.
    const declaredQueues = options.queues ?? [];
    const queueNames = new Set<string>();
    for (const config of declaredQueues) {
      if (!isMochiQueue(config)) {
        throw new Error(`Mochi.serve({ queues }): every element must be a descriptor created with Mochi.queue(name, …).`);
      }
      if (typeof config.name !== 'string' || !/^[\w.\-/]+$/.test(config.name)) {
        throw new Error(`Mochi.serve({ queues }): "${config.name}" is not a valid queue name. Names may only contain letters, digits, underscores, dots, dashes, and slashes.`);
      }
      if (config.name.startsWith('cron-')) {
        throw new Error(`Mochi.serve({ queues }): "${config.name}" uses the reserved "cron-" prefix — that namespace is for scheduled jobs (Mochi.cron). Rename the queue.`);
      }
      if (queueNames.has(config.name)) {
        throw new Error(`Mochi.serve({ queues }): two queues are named "${config.name}". Queue names must be unique.`);
      }
      queueNames.add(config.name);
      // Descriptor form is self-sufficient — the target is ensured on its own; only a bare name needs the array.
      // Self-references and conflicting duplicates are caught by the closure walk below.
      const deadLetter = config.options?.deadLetter;
      if (typeof deadLetter === 'string' && !declaredQueues.some((q) => q.name === deadLetter)) {
        throw new Error(
          `Mochi.serve({ queues }): "${config.name}" names "${deadLetter}" as its deadLetter queue, but no queue with that name is declared in the same queues array. Declare it there, or pass its descriptor (deadLetter: Mochi.queue("${deadLetter}", …)) so it is ensured on its own.`,
        );
      }
    }
    // An app has one queue storage: declared on the descriptors (deadLetter targets included), app-wide via
    // queueStorage, or both when they agree.
    let declaredStorage: { name: string; storage: MochiQueueStorage } | undefined;
    for (const { name, storage } of collectQueueClosure(declaredQueues, 'Mochi.serve({ queues })')) {
      if (storage === undefined) {
        continue;
      }
      if (declaredStorage && !storageEquals(declaredStorage.storage, storage)) {
        throw new Error(`Mochi.serve({ queues }): "${name}" and "${declaredStorage.name}" declare different storages — an app has one queue storage.`);
      }
      declaredStorage ??= { name, storage };
    }
    if (options.queueStorage !== undefined && declaredStorage && !storageEquals(declaredStorage.storage, options.queueStorage)) {
      throw new Error(
        `Mochi.serve({ queueStorage }): "${declaredStorage.name}" declares a different storage — an app has one queue storage. Align the two declarations, or drop one.`,
      );
    }
    const queueStorage = options.queueStorage ?? declaredStorage?.storage ?? 'memory';
    if (!isValidQueueStorage(queueStorage)) {
      throw new Error(`Mochi.serve({ queueStorage }): expected 'memory', { sqlite: 'path/to.db' }, { postgres: url }, or { pglite: instance }.`);
    }
    if (options.queueStorage !== undefined && declaredQueues.length === 0) {
      logger.warn(`Mochi.serve({ queueStorage }) has no effect without a non-empty queues array — the queue runtime only starts when queues are declared.`);
    }
    if (declaredQueues.length > 0) {
      // Fail before the config singleton pins and the server binds — rejecting this deep in the boot would wedge the process.
      assertNoConflictingStandaloneRuntime(queueStorage);
    }

    // Same fail-fast rule for cron: a bad descriptor or duplicate name rejects before the config singleton pins and
    // the socket binds, so a typo can never leave a half-scheduled server listening.
    const declaredCron = options.cron ?? [];
    const cronNames = new Set<string>();
    for (const job of declaredCron) {
      if (!isMochiCron(job)) {
        throw new Error(`Mochi.serve({ cron }): every element must be a descriptor created with Mochi.cron(name, schedule, …).`);
      }
      if (typeof job.name !== 'string' || !/^[\w.\-/]+$/.test(job.name)) {
        throw new Error(`Mochi.serve({ cron }): "${job.name}" is not a valid cron job name. Names may only contain letters, digits, underscores, dots, dashes, and slashes.`);
      }
      if (cronNames.has(job.name)) {
        throw new Error(`Mochi.serve({ cron }): two cron jobs are named "${job.name}". Cron job names must be unique.`);
      }
      cronNames.add(job.name);
    }
    // Independent of queueStorage: cron always runs on its own bun-boss instance, defaulting to in-process memory.
    const cronStorage = options.cronStorage ?? 'memory';
    if (declaredCron.length > 0 && !isValidQueueStorage(cronStorage)) {
      throw new Error(`Mochi.serve({ cronStorage }): expected 'memory', { sqlite: 'path/to.db' }, { postgres: url }, or { pglite: instance }.`);
    }

    // Same fail-fast rule: an unmountable prefix rejects here rather than 404ing at runtime.
    const staticDirMounts = options.staticDirs ? resolveStaticDirs(options.staticDirs, normalizeAssetPrefix(options.assetPrefix)) : [];

    const { svelteVersion } = await checkEnvironment();
    const mochiVersion = await readMochiVersion();
    initExtensions(options);
    await runHook('mochi:init', { options });
    await initMochiConfig(options);

    // Resolved once at startup and captured by the per-request closures below. Each default Set is copied before it
    // reaches the user, so an in-place mutation can't poison the framework default for the next call.
    const formContentTypes: ReadonlySet<string> = applyFilter('csrf:formContentTypes', new Set(DEFAULT_FORM_CONTENT_TYPES), { options });
    const protectedMethods: ReadonlySet<string> = applyFilter('csrf:protectedMethods', new Set(DEFAULT_PROTECTED_METHODS), { options });
    const trustedOrigins: ReadonlySet<string> = applyFilter('csrf:trustedOrigins', new Set(options.csrf?.trustedOrigins ?? []), { options });
    const cookieDefaults = applyFilter('cookie:defaults', {}, { options });

    const bootCsrfWarning = csrfBootWarning(options);
    if (bootCsrfWarning) {
      logger.warn(bootCsrfWarning);
    }

    const development = options.development ?? true;
    const inlineNestedIslands = options.inlineNestedIslands !== false;
    const warmupEnabled = resolveWarmupEnabled(options.warmup, development);
    const debugBarEnabled = development && (options.debugBar ?? true);
    const liveReloadEnabled = options.liveReload ?? development;
    // i18n (Wuchale) wiring runs before component compilation so its transform
    // is registered as a `compile:preprocessors` filter; its locale middleware
    // is composed to the front of the user's handle chain.
    let middleware = options.handle;
    let i18nWatch: MochiI18nWatchHook | undefined;
    if (options.i18n) {
      const { handle: i18nHandle, i18n } = await setupWuchaleI18n(options.i18n, { development, projectRoot: process.cwd() });
      i18nWatch = i18n;
      middleware = middleware ? sequence(i18nHandle, middleware) : i18nHandle;
    }
    const protectionEnabled = options.protection?.enabled === true;
    const baseOutDir = options.outDir ?? './.mochi';
    // Nesting dev artifacts keeps a stale prod manifest and dev chunks apart across a later `start`, while prod stays at
    // the root so Docker and deploys are unaffected.
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

    // In production, load prebuilt assets from manifest if available
    const manifestPath = options.manifest ?? `${outDir}/manifest.json`;
    let registry: ComponentRegistry;
    if (!development && existsSync(manifestPath)) {
      logger.info(`Loading prebuilt manifest from ${manifestPath}`);
      // The registry takes its outDir from the manifest's own directory, so an explicit `manifest` pointing elsewhere
      // relocates on-demand island compiles along with it.
      registry = await ComponentRegistry.fromManifest(manifestPath, development, { fonts: options.fonts });
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
        fonts: options.fonts,
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
        // Production without a prebuilt manifest is valid but much slower, compiling components at boot and server islands
        // on the request path; the error level keeps a forgotten build from masquerading as a healthy deploy.
        logger.error(
          `Running in production without a prebuilt manifest (${manifestPath} not found). ` +
            `This is an unsupported configuration and is not recommended: components compile at startup ` +
            `and server islands compile on the first request, making cold starts and initial responses ` +
            `much slower. Run \`mochi-framework build\` before \`start\` to precompile and bake the manifest.`,
        );
      }
    }

    const emailTransportType = getEmailRuntime().options.transport.type;
    // The dev outbox captures mail off the resolved transport alone, so the viewer route must key off the same condition;
    // keying it off the debug bar would let `debugBar: false` capture mail with no way to read it back.
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
        protection: protectionEnabled,
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

    // Both render closures below capture `shellTemplate` by reference, so reassigning it lands on the next request.
    const reloadShell = shellPath
      ? async () => {
          shellTemplate = applyFilter('html:shell', await Bun.file(shellPath).text(), { options, development });
        }
      : undefined;

    // Read through a getter for the same reason: a dev entry edit re-extracts the option and swaps it in place.
    let speculationRules = options.speculationRules;
    const reloadSpeculationRules = development
      ? (rules: SpeculationRules | undefined) => {
          speculationRules = rules;
        }
      : undefined;

    const errorPagePath = options.errorPage ?? DEFAULT_ERROR_PAGE_PATH;

    // Resolved before compileAll so the interstitial page (default or custom) rides the same one-shot build.
    const protectionOptions = protectionEnabled && options.protection ? resolveProtectionOptions(options.protection, getCaptchaRuntime().options.bits) : undefined;

    // Compiling every page entrypoint in one `Bun.build` below lets splitting pull shared transitive deps (devalue,
    // mochi-framework internals) into chunk files instead of inlining them per page.
    const ssrEntrypoints: string[] = [errorPagePath, CLIENT_STATS_COMPONENT];
    if (debugBarEnabled) {
      ssrEntrypoints.push(PAGE_CACHE_ADMIN_COMPONENT);
    }
    if (protectionOptions) {
      ssrEntrypoints.push(protectionOptions.page ?? PROTECTION_SHELL_COMPONENT);
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
      getSpeculationRules: () => speculationRules,
      fontPreload: options.fonts?.preload !== false,
    });

    // The interstitial renders through the app shell like error pages do, so a custom `protection.page`
    // component inherits the site's styling for free.
    const protectionRuntime = protectionOptions
      ? createProtectionRuntime({
          options: protectionOptions,
          registry,
          renderShell: (result) => renderShell(result),
          assetPrefix: registry.assetPrefix,
          newRequestId,
          proxy: options.proxy,
          trailingSlashPolicy: options.trailingSlash,
        })
      : undefined;

    const { renderErrorResponse, routeErrorResponse } = createErrorResponder({
      handleError: options.handleError,
      development,
      registry,
      errorPagePath,
      renderShell: (result) => renderShell(result),
      cookieDefaults,
      newRequestId,
      proxy: options.proxy,
    });

    // Mirrors the handleError logic in renderErrorResponse, skipping the HTML render for the enhanced JSON path.
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
      protection: protectionRuntime?.gate,
    });

    const internalRoutes: Record<string, MochiPageConfig | MochiApiConfig> = {
      // Gated behind the debug bar, like the page-cache admin routes, since the stats page discloses every bundle's input
      // file paths and sizes — project structure and dependency names.
      ...(debugBarEnabled ? buildClientStatsRoutes(registry) : {}),
      ...(debugBarEnabled ? buildPageCacheAdminRoutes() : {}),
      ...(emailViewerEnabled ? buildEmailViewerRoutes(registry) : {}),
    };
    const allRoutes = Object.keys(internalRoutes).length > 0 ? { ...internalRoutes, ...(options.routes ?? {}) } : options.routes;

    const rateLimitStores = new Set<MochiRateLimitStore>();
    // Route closures look their limiter up per request so the dev watcher can swap one in place when a route's
    // `rateLimit` config changes; capturing it in a const would pin the boot-time config until restart. A null entry
    // marks a limitable route with no limiter.
    const routeLimiters = new Map<string, RouteLimiter | null>();
    let sharedGlobalLimiter: RouteLimiter | null = null;
    function buildLimiter(routeCfg: MochiRateLimitOptions | false | undefined, pattern: string): RouteLimiter | null {
      if (routeCfg === false) {
        return null;
      }
      if (routeCfg) {
        // A route's own config is auto-namespaced by its pattern, keeping two routes on a shared persisted store off one
        // bucket. The shared global limiter below passes no pattern, so its routes stay on a common bucket.
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
        // sqliteStore's shutdown can throw synchronously from its finalize-verification guard, which a bare
        // `Promise.resolve()` would let escape into the dev watcher.
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
          const resolved = isServerPropsResolver(liveServerProps) ? ((await liveServerProps(req, ctx.params)) ?? {}) : (liveServerProps ?? {});
          if (isRedirect(resolved)) {
            const redirectResponse = new Response(null, {
              status: resolved.status,
              headers: { Location: resolved.location },
            });
            return applyResolveOptions(redirectResponse, resolveOpts);
          }
          if (isFormFail(resolved) || isFormSuccess(resolved)) {
            throw new Error(
              `[mochi] Route "${pattern}" serverProps returned ${isFormFail(resolved) ? 'fail()' : 'success()'} — those are form-action results. ` +
                `serverProps may return props or redirect(status, location).`,
            );
          }
          const baseProps = resolved;
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
          const setup = await buildRequestContext(req, server, {
            kind: 'page',
            pattern,
            csrfErrorTransform: (resp) => (isEnhanceRequest(req) ? jsonError(resp.status, 'Cross-site form submission forbidden') : resp),
          });
          if ('earlyResponse' in setup) {
            return setup.earlyResponse;
          }
          const { ctx, start, requestId, url, params } = setup;
          const event: MochiEvent = { request: req, url, server, locals: ctx.locals, kind: 'page', isWarmup: ctx.isWarmup };

          return requestContext.run(ctx, async () => {
            runHook('route:matched', { pattern, request: req, url, params, kind: 'page' });
            const innerResolve = async (_event: MochiEvent, resolveOpts?: MochiResolveOptions): Promise<Response> => inner(ctx, event, resolveOpts);

            const gate = await checkRouteLimit(routeLimiters.get(pattern) ?? null, ctx, req);
            let blockedResponse: Response | undefined;
            if (gate.blockedMessage) {
              // Enhanced form POSTs expect JSON (mirrors csrfErrorTransform above);
              // everything else gets the configured error page at 429.
              blockedResponse = isEnhanceRequest(req)
                ? jsonError(429, gate.blockedMessage)
                : await routeErrorResponse(req, event, undefined, new MochiHttpError(429, gate.blockedMessage));
            }

            const response = blockedResponse ?? (middleware ? await middleware({ event, resolve: innerResolve }) : await innerResolve(event));

            let final = finalizeCookieHeaders(response, ctx.cookies);
            if (gate.headers) {
              final = applyRateLimitHeaders(final, gate.headers);
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
              if (isRedirect(result)) {
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
        // A method-keyed object keeps a POST/PUT to an action-less page from matching (it falls through to the fetch
        // handler and 404s); a bare function runs for every method and would render 200 on POST in production,
        // diverging from dev, where `pageConfigMap` forces this path anyway.
        return { bunRouteValue: withHead({ GET: getHandler } as unknown as BunRouteValue), type: 'page' };
      } else if (isMochiApi(handler)) {
        if (apiHandlerMap) {
          apiHandlerMap.set(pattern, handler.handler);
        }
        const capturedApiHandler = handler.handler;
        resolveLimiter(handler.rateLimit, pattern);

        const bunRouteValue: BunRouteValue = async (req: Request, server: Server<undefined>): Promise<Response> => {
          const setup = await buildRequestContext(req, server, { kind: 'api', pattern });
          if ('earlyResponse' in setup) {
            return setup.earlyResponse;
          }
          const { ctx, start, requestId, url, params } = setup;

          return requestContext.run(ctx, async () => {
            runHook('route:matched', { pattern, request: req, url, params, kind: 'api' });
            const event: MochiEvent = { request: req, url, server, locals: ctx.locals, kind: 'api', isWarmup: ctx.isWarmup };

            const gate = await checkRouteLimit(routeLimiters.get(pattern) ?? null, ctx, req);
            let blockedResponse: Response | undefined;
            if (gate.blockedBody) {
              blockedResponse = Response.json(gate.blockedBody, { status: 429 });
            }

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

            const response = blockedResponse ?? (middleware ? await middleware({ event, resolve: innerResolve }) : await innerResolve(event));

            let final = finalizeCookieHeaders(response, ctx.cookies);
            if (gate.headers) {
              final = applyRateLimitHeaders(final, gate.headers);
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

        const bunRouteValue = (async (req: Request, server: Server<undefined>) => {
          const setup = await buildRequestContext(req, server, { kind: 'ws', pattern });
          if ('earlyResponse' in setup) {
            return setup.earlyResponse;
          }
          const { ctx: wsHookCtx, start, requestId: wsRequestId, url: wsUrl, params: wsParams } = setup;
          const wsPath = wsUrl.pathname + wsUrl.search;
          // A non-upgrade request (e.g. a HEAD probe or plain GET) never becomes
          // a socket, so it never emits `ws:open`.
          const emitWsReject = (status: number): void => {
            mochiEvents.emit('request', {
              requestId: wsRequestId,
              kind: 'error',
              method: req.method,
              path: wsPath,
              status,
              duration: performance.now() - start,
            });
          };
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
              emitWsReject(400);
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
              __mochiPath: wsPath,
              user: userData,
            } satisfies MochiWsData,
          });

          if (!success) {
            emitWsReject(500);
            return new Response('WebSocket upgrade failed', { status: 500 });
          }
          mochiEvents.emit('ws:open', {
            path: wsPath,
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
          const setup = await buildRequestContext(req, server, { kind: 'sse', pattern });
          if ('earlyResponse' in setup) {
            return setup.earlyResponse;
          }
          const { ctx: sseHookCtx, start: sseStart, requestId: sseRequestId, url, params: sseParams } = setup;
          const path = url.pathname + url.search;
          // SSE streams are GET-only. HEAD is not supported: answering it would
          // mean either opening a stream (defeats the point of a body-less probe)
          if (req.method === 'HEAD') {
            mochiEvents.emit('request', {
              requestId: sseRequestId,
              kind: 'error',
              method: req.method,
              path,
              status: 405,
              duration: performance.now() - sseStart,
            });
            return new Response(null, { status: 405, headers: { Allow: 'GET' } });
          }
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
      } else if (isMochiFile(handler)) {
        const source = handler.source;

        const bunRouteValue: BunRouteValue = async (req: Request, server: Server<undefined>): Promise<Response> => {
          const setup = await buildRequestContext(req, server, { kind: 'file', pattern });
          if ('earlyResponse' in setup) {
            return setup.earlyResponse;
          }
          const { ctx, start, requestId, url, params } = setup;

          return requestContext.run(ctx, async () => {
            runHook('route:matched', { pattern, request: req, url, params, kind: 'file' });

            const finish = (response: Response): Response => {
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
            };

            try {
              const filePath = typeof source === 'function' ? await source(req, ctx.params) : source;
              // Route params are URL-decoded and may contain `../`, so the resolved path is confined to the app root.
              // `realpath` resolves symlinks first, closing the in-root-symlink-points-out escape, and proves the file
              // exists (ENOENT → 404); containment goes through `path.relative`, which handles separators and canonical casing.
              const resolvedPath = path.resolve(filePath);
              let realPath: string;
              try {
                realPath = await realpath(resolvedPath);
              } catch {
                emitError('file', requestId, req, url, 404, new Error(`File not found: ${filePath}`));
                return finish(new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
              }
              const appRoot = process.cwd();
              const rel = path.relative(appRoot, realPath);
              if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
                emitError('file', requestId, req, url, 404, new Error(`Path escapes the app root: ${filePath}`));
                return finish(new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
              }
              // The containment check above only stops escapes, so dotfiles and dot-directories inside the root
              // (`.env`, `.mochi/…`, `.git/…`) are rejected here. `.well-known` stays allowed, matching the public-dir policy.
              if (isExcludedDotPath(toPosixPath(rel))) {
                emitError('file', requestId, req, url, 404, new Error(`Refusing to serve dotfile path: ${filePath}`));
                return finish(new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
              }
              const file = Bun.file(realPath);
              // `realpath` resolves directories too, so this turns a directory target into a 404 rather than an EISDIR 500.
              if (!(await file.exists())) {
                emitError('file', requestId, req, url, 404, new Error(`File not found: ${filePath}`));
                return finish(new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
              }
              if (req.method === 'HEAD') {
                return finish(new Response(null, { status: 200, headers: { 'Content-Type': file.type || 'application/octet-stream', 'Content-Length': String(file.size) } }));
              }
              // new Response(Bun.file) sets Content-Type and Content-Length automatically.
              return finish(new Response(file));
            } catch (err) {
              if (err instanceof MochiHttpError) {
                logger.error(`${req.method} ${url.pathname} → ${err.status}: ${err.message}`);
                emitError('file', requestId, req, url, err.status, err);
                return finish(new Response(err.message, { status: err.status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
              }
              logger.error(`${req.method} ${url.pathname} → 500:`, err);
              emitError('file', requestId, req, url, 500, err);
              return finish(new Response('Internal Server Error', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
            }
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

    const slashMirrorPatterns: string[] = [];
    if (allRoutes) {
      for (const [pattern, handler] of Object.entries(allRoutes)) {
        const result = await registerRoutePattern(pattern, handler);
        if (result) {
          bunRoutes[pattern] = result.bunRouteValue;
          routeCounts[result.type] += 1;
          if (mirrorsSlashForm(result.type)) {
            slashMirrorPatterns.push(pattern);
          }
        } else {
          // Raw Bun route values (static Responses, HTML imports) answer on both slash forms.
          bunRoutes[pattern] = handler as BunRouteValue;
          slashMirrorPatterns.push(pattern);
        }
      }
    }

    // Registering the alt-slash variant lets Bun's literal pattern matcher match both `/foo` and `/foo/`; the per-handler
    // redirect checks above then turn the non-canonical form into a 301/308. Only pages and raw Bun route values take
    // part — every other kind is skipped entirely, so just the exact declared pattern matches it.
    if (trailingSlashPolicy) {
      for (const pattern of slashMirrorPatterns) {
        const alt = alternateSlashPattern(pattern);
        if (alt && !(alt in bunRoutes)) {
          bunRoutes[alt] = bunRoutes[pattern]!;
        }
      }
    }

    // After the mirroring pass on purpose: a `/*` pattern must not be mirrored to `/*\/`.
    registerStaticDirRoutes(bunRoutes, staticDirMounts);

    // Register server island endpoint
    bunRoutes[`${registry.assetPrefix}/island/:componentName`] = withHead(async (req: Request, server: Server<undefined>): Promise<Response> => {
      const setup = await buildRequestContext(req, server, {
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

      // `islandId` and `__mochi_ah` ride inside the signed envelope as transport only, and are split into a fresh object
      // so neither reaches the component as a prop. The hydrate mode comes from the decrypted payload: trusting a
      // `?hydrate=` query param would let anyone append it to a sealed token and get the props echoed back in plaintext.
      const { [ALSO_HYDRATE_ENVELOPE_KEY]: rawHydrateMode, islandId: rawIslandId, ...props } = decodedProps;
      const islandId = typeof rawIslandId === 'string' ? rawIslandId : undefined;
      const hydrateMode = isAlsoHydrateMode(rawHydrateMode) ? rawHydrateMode : null;

      // Look up the component path
      const componentPath = registry.getServerIslandPath(componentName);
      if (!componentPath) {
        return new Response('Unknown server island component', { status: 404 });
      }

      // Arm nested-island inlining for this render. Also-hydrate renders are excluded: their subtree re-renders on the
      // client, and a nested defer site there is a compile error anyway (`defer-in-hydratable`).
      if (hydrateMode === null && inlineNestedIslands) {
        ctx.islandInline = { budget: applyFilter('serverIsland:inlineBudget', DEFAULT_INLINE_BUDGET, { componentName, request: req }) };
      }

      return requestContext.run(ctx, async () => {
        // A miss here means the build's eager discovery (see build.ts) didn't
        // find this island; `compileAll` warns about any manifest miss, so the
        // request-path compile this endpoint is supposed to prevent is never
        // silent.
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
          return new Response(stub, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'private, no-store',
            },
          });
        }

        let body = result.body;

        if (isAlsoHydrateMode(hydrateMode)) {
          const componentUrl = registry.getComponentEntryUrl(componentName);
          const serializedProps = devalueStringify(props);

          let hydrateAttrs = `component-name="${componentName}"`;
          if (Object.keys(props as Record<string, unknown>).length > 0) {
            hydrateAttrs += ` props="${escapeHtmlAttr(serializedProps)}"`;
          }
          if (componentUrl) {
            hydrateAttrs += ` component-url="${componentUrl}"`;
          }

          body = `<mochi-hydratable-island ${hydrateAttrs}>${body}</mochi-hydratable-island>`;
        }

        // Appended whenever the rendered subtree carries hydratables — the also-hydrate island itself, plain
        // mochi:hydrate children, or inlined also-hydrate islands — so the fragment self-hydrates even on a page that
        // shipped no bootstrap of its own; duplicate module scripts are no-ops by src.
        const bootstrapUrl = result.bootstrapUrl ?? (isAlsoHydrateMode(hydrateMode) ? registry.getIslandBootstrapUrl() : null);
        if (bootstrapUrl) {
          body += `<script type="module" src="${bootstrapUrl}"></script>`;
        }

        // CSS for islands rendered only inside this deferred content is gated out of the page `<head>`, so its `<link>`
        // tags are prepended here along with side-effect CSS imports; browsers honour a `<link>` assigned via `innerHTML`.
        // The island's own scoped CSS is excluded, since the wrapper's `css-url` attribute already loads it.
        const ownCss = registry.getComponentCssUrl(componentPath);
        const extraCss = result.cssUrls.filter((url) => url !== ownCss);
        if (extraCss.length > 0) {
          body = extraCss.map(cssLinkTag).join('') + body;
        }

        return new Response(body, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'private, no-store',
          },
        });
      });
    });

    // Gives `Mochi.email()` the live compile cache, so Svelte email templates render through the same registry as page routes.
    getEmailRuntime().registry = registry;

    // The resolved options are the single source of truth for `enabled`; `getImageUrl` reads the same flag to fall back
    // to raw source URLs when the endpoint is off.
    let stopImageSweeper: (() => void) | undefined;
    const imageRuntime = getImageRuntime();
    if (imageRuntime.options.enabled) {
      const imageHandler = createImageHandler();
      bunRoutes[`${registry.assetPrefix}/image/:filename`] = withHead(async (req: Request): Promise<Response> => {
        const start = performance.now();
        const response = await imageHandler(req);
        const url = new URL(req.url);
        mochiEvents.emit('request', {
          requestId: newRequestId(req),
          kind: 'image',
          method: req.method,
          path: url.pathname + url.search,
          status: response.status,
          duration: performance.now() - start,
        });
        return response;
      });
      stopImageSweeper = startImageCacheSweeper(imageRuntime.cache, imageRuntime.options.sweepIntervalMs);
    }

    // Plain static serving of locally-imported image assets (`import x from './x.png'`), so it registers independently
    // of `image.enabled`. The handler reads the global registry the build populated, letting new dev images appear
    // without a route reload.
    bunRoutes[`${registry.assetPrefix}/asset/:filename`] = withHead(createLocalAssetHandler(development));

    // The debug bar's Cache tab reads the entry count (GET) and empties the image cache (POST). It registers with the
    // debug bar rather than the image endpoint, since the tab always shows and acting on an empty cache is a no-op.
    if (debugBarEnabled) {
      const imageCacheHandler = async (req: Request): Promise<Response> => {
        if (req.method === 'POST') {
          await imageRuntime.cache.clearAll();
          return Response.json({ ok: true, count: 0, keys: [] });
        }
        if (req.method === 'GET') {
          // `keys` already excludes transient in-flight markers, so the debug bar badge matches the number of listed keys.
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
          // 410 marks a key evicted between listing and expanding, which a 404 would leave indistinguishable from an
          // unregistered route or a mangled key.
          return new Response('Gone', { status: 410 });
        }
        return Response.json({ key, value });
      };
      // Register both slash variants so they work under any `trailingSlash` policy.
      bunRoutes[`${registry.assetPrefix}/image-cache`] = imageCacheHandler;
      bunRoutes[`${registry.assetPrefix}/image-cache/`] = imageCacheHandler;
      bunRoutes[`${registry.assetPrefix}/image-cache/entry`] = imageCacheEntryHandler;
      bunRoutes[`${registry.assetPrefix}/image-cache/entry/`] = imageCacheEntryHandler;
    }

    if (protectionRuntime) {
      const { verifyPath, options: protectionOptions } = protectionRuntime;
      const verifyHandler = async (req: Request, server: Server<undefined>): Promise<Response> => {
        if (req.method !== 'POST') {
          return new Response('Method Not Allowed', { status: 405 });
        }
        const setup = await buildRequestContext(req, server, { kind: 'api', pattern: verifyPath, skipProtection: true });
        if ('earlyResponse' in setup) {
          return setup.earlyResponse;
        }
        const { ctx, start, requestId, url } = setup;
        let formData: FormData;
        try {
          formData = await req.formData();
        } catch {
          return jsonError(400, 'Expected form data');
        }
        // minBits stops a token minted for an easier captcha (a low-bits form) being redeemed for clearance.
        const result = await verifyCaptcha(formData, { minAgeMs: 0, minBits: protectionOptions.bits });
        let response: Response;
        if (result.ok) {
          ctx.cookies.set(protectionOptions.cookieName, mintClearanceToken(protectionOptions.bits), {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            maxAge: Math.floor(protectionOptions.maxAgeMs / 1000),
            secure: url.protocol === 'https:',
          });
          response = Response.json({ ok: true });
        } else {
          response = Response.json({ ok: false, error: result.error }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
        }
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
      };
      // Both slash variants, like the image-cache routes, so the endpoint answers under any trailingSlash policy.
      bunRoutes[verifyPath] = verifyHandler;
      bunRoutes[`${verifyPath}/`] = verifyHandler;
    }

    if (process.env.MOCHI_MEMORY_PROBE === '1') {
      bunRoutes['/__mochi/health/memory'] = (): Response => {
        Bun.gc(true);
        return Response.json({
          timestamp: Date.now(),
          memory: process.memoryUsage(),
        });
      };
    }

    // Snapshotted so the dev-mode public watcher can rebuild cleanly when files are added, removed, or renamed.
    const baseBunRoutes: Record<string, BunRouteValue> = { ...bunRoutes };

    // Every mode scans `publicDir` from disk, and user-defined routes win, so a public route is added only where no user
    // route claims the path. The dev-watcher reload rebuilds them through these same helpers.
    const initialPublicFiles = await resolvePublicFiles({ publicDir, development });
    // The build copies nothing, so on disk a deploy that ships the build output and forgets publicDir is
    // indistinguishable from an app that never had static files, leaving the build-time count the only witness. It
    // warns rather than throws, since dropping the directory on purpose is legitimate.
    if (!development && registry.loadedFromManifest && registry.publicFileCountAtBuild > 0 && initialPublicFiles.size === 0) {
      logger.warn(
        `publicDir "${relForDisplay(publicDir)}" is missing or empty, but the build found ${registry.publicFileCountAtBuild} file(s) there — every static file will 404. ` +
          `The build never copies publicDir; the runtime reads it on every boot, so that directory has to ship with your deploy ` +
          `(in Docker, a COPY for it in the final stage — and check .dockerignore). ` +
          `If it moved, point \`publicDir\` at the new location; if the files are gone on purpose, re-run \`mochi-framework build\` to clear this.`,
      );
    }
    // publicDir files bypass buildRequestContext (they're raw Bun routes), so protection reaches them through this
    // guard. Finalizing the served file through the same jar the gate read adds `Vary: Cookie` to cleared responses.
    const publicRouteGuard =
      protectionRuntime && protectionRuntime.options.protectFiles
        ? async (req: Request, server: Server<undefined>, serve: () => Promise<Response>): Promise<Response> => {
            const cookies = new MochiCookieJar(req.headers.get('Cookie'), cookieDefaults);
            const blocked = await protectionRuntime.gate({
              request: req,
              url: buildPublicUrl(req, options.proxy),
              kind: 'file',
              cookies,
              server,
            });
            return blocked ?? finalizeCookieHeaders(await serve(), cookies);
          }
        : undefined;
    registerPublicRoutes(bunRoutes, initialPublicFiles, publicRouteGuard);

    const userFetch = options.fetch;

    const composedFetch = async (req: Request, server: Server<undefined>): Promise<Response> => {
      const url = buildPublicUrl(req, options.proxy);
      const csrfResponse = csrfCheck(req, url, options.csrf, options.proxy, development, formContentTypes, protectedMethods, trustedOrigins);
      if (csrfResponse) {
        return csrfResponse;
      }

      // Non-route requests run middleware too, so static-asset paths (`/_mochi/client/...` bundles) share the chain and a
      // user `gzip()` compresses them like any other response. Kind is precomputed so middleware can branch on it.
      const assetContent = registry.getClientFile(url.pathname);
      const diskAsset = assetContent === undefined ? (registry.getFontAsset(url.pathname) ?? registry.getImportedCssAsset(url.pathname)) : undefined;
      const kind: MochiEventKind = assetContent !== undefined || diskAsset !== undefined ? 'asset' : userFetch ? 'fallback' : 'error';

      const event: MochiEvent = { request: req, url, server, locals: {}, kind, isWarmup: false };

      // `_event` exists only for parity with `MochiResolveFn`; `url`, `req`, and `assetContent` are already fixed in the
      // enclosing scope.
      const innerResolve = async (_event: MochiEvent, resolveOpts?: MochiResolveOptions): Promise<Response> => {
        if (assetContent !== undefined) {
          // `getClientFile()` returns only registered `.js` or `.css`, so extension alone decides and this branch stays
          // independent of the asset prefix.
          const contentType = url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript';
          const headers: Record<string, string> = { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff' };
          // Content-hashed filenames change URL whenever bytes change, so prod can mark them immutable; dev skips it to
          // keep live-reload edits out of the browser cache.
          if (!development) {
            headers['Cache-Control'] = 'public, max-age=31536000, immutable';
          }
          return applyResolveOptions(new Response(assetContent, { headers }), resolveOpts);
        }
        if (diskAsset !== undefined) {
          return applyResolveOptions(await serveDiskAsset(diskAsset, development), resolveOpts);
        }
        if (userFetch) {
          // Assets never reach here, so only user-fetch fallbacks are gated — the interstitial's own JS/CSS stays loadable.
          if (protectionRuntime) {
            const cookies = new MochiCookieJar(req.headers.get('Cookie'), cookieDefaults);
            const blocked = await protectionRuntime.gate({ request: req, url, kind: 'fallback', cookies, server });
            if (blocked) {
              return applyResolveOptions(blocked, resolveOpts);
            }
            // The gate read the clearance cookie, so a cleared response varies on it like any page's would.
            return applyResolveOptions(finalizeCookieHeaders(await userFetch(req, server), cookies), resolveOpts);
          }
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
      cron: _cron,
      cronStorage: _cronStorage,
      websocket: userWebSocketOptions,
      bun: bunPassthrough,
      ...bunOptions
    } = options as Record<string, unknown>;

    // Registered before the dispatcher is built, so the internal live-reload socket shares the same Bun WebSocket option
    // as user `Mochi.ws()` routes and keeps `wsHandlersMap.size > 0` true even with no user WebSocket routes.
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
        // Proxies and sleeping network stacks swallow protocol pings, leaving a socket that reads OPEN but is dead, so
        // the client heartbeat needs an application-level reply.
        message(ws, message) {
          if (typeof message === 'string' && message === 'ping') {
            ws.send('pong');
          }
        },
        close(ws) {
          liveReloadClients.delete(ws as ServerWebSocket<MochiWsData>);
        },
      });

      // Reusing the live-reload socket for dev-outbox arrivals lets open tabs surface a "new email" badge without a
      // second WebSocket, and the captured id lets the toolbar track which messages are still unread.
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

    const server = Bun.serve({
      ...bunOptions,
      ...(bunPassthrough as Record<string, unknown> | undefined),
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
      // The shutdown path calls `stop()` twice — graceful, then forced once the grace period lapses — and a second
      // teardown would double-close an already-closed transport.
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
          removeMemoryPressureHandler();
          // The cron boss is a timekeeper and a SQL handle outliving the socket: without this, an embedded caller that
          // stops the server directly (rather than via a signal or Mochi.stop()) keeps enqueuing runs into a dead app.
          await stopCronRuntime();
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

    // Installed once the server is up, so a boot that throws never leaves a listener behind on a dead process; never
    // in development, where the compile-heavy boot hair-triggers the OS signal and the reclaim would be a spurious no-op.
    if (!development && (options.memoryPressure ?? true)) {
      installMemoryPressureHandler();
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

    // Mounted after bind so the queues drain on the same shutdown path as the server; a throw mid-mount tears the
    // just-bound server down rather than leaving it listening half-started.
    try {
      if (declaredQueues.length > 0) {
        // kind 'serve' adopts a standalone producer runtime already connected to the same storage.
        await startQueueRuntime(queueStorage, { kind: 'serve' });
        await mountQueues(declaredQueues, resolveQueueConfigMode(options.queueConfig), options.queueShutdownTimeout);
      }
    } catch (err) {
      await closeAllQueueResources();
      await server.stop(true);
      throw err;
    }
    // Fires once every declared queue is registered, so a user hook reaching for a handle (or `Mochi.boss()`)
    // gets it instead of a "not mounted yet" error.
    await runHook('mochi:queuesMounted', { options, server, queues: declaredQueues.map((q) => q.name) });

    // After the queues mount, so a job firing immediately can reach Mochi.getQueue(); a throw here tears the
    // just-bound server down rather than leaving it listening with half a schedule registered.
    if (declaredCron.length > 0) {
      try {
        await startCronRuntime(declaredCron, { cronStorage, development, jitterMs: development ? 0 : CRON_JITTER_MS, shutdownTimeout: options.queueShutdownTimeout });
      } catch (err) {
        await closeAllQueueResources();
        await server.stop(true);
        throw err;
      }
    }

    if (warmupHandlers.length > 0) {
      mochiEvents.emit('warmup:start', { routeCount: warmupHandlers.length });
      const t0 = performance.now();
      // SSR is CPU-bound and serializes on the single thread, so parallel warming would render no faster while smearing
      // every route's `request` duration into the batch total; one at a time keeps per-route timings honest.
      void (async () => {
        let errorCount = 0;
        for (const { pattern, handler } of warmupHandlers) {
          // The canonical path keeps the trailing-slash policy from redirecting early instead of running the render being warmed.
          const url = new URL(`http://localhost${pattern}`);
          const redirect = trailingSlashPolicy ? trailingSlashRedirect('GET', url, trailingSlashPolicy) : null;
          const href = redirect ? new URL(redirect.headers.get('Location') ?? pattern, url).href : url.href;
          try {
            // The handler swallows render errors and returns a 5xx error page, so 5xx counts as "didn't warm cleanly"
            // alongside a throw. 4xx is expected — an auth-gated route seeing the anonymous warmup visitor.
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
        initialCronSignature: cronSignature(declaredCron),
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
        reloadSpeculationRules,
        publicRouteGuard,
        i18n: i18nWatch,
      });
    }

    Mochi.installShutdownHandlers(options, server, development);
    await runHook('mochi:ready', { options, server });

    return server;
  }

  /**
   * Gracefully stop everything Mochi is running — the `mochi:shutdown` hook, queue drain, and server stop — without
   * exiting the process, so a finite-lifetime embedder (script, test) can end naturally instead of signalling itself.
   * In a process that never served, it tears down a standalone producer queue runtime. Idempotent; the SIGTERM/SIGINT
   * handlers run the same path. A stopped process cannot `Mochi.serve()` again.
   */
  static stop(): Promise<void> {
    return performShutdown();
  }

  /**
   * Install one-shot SIGTERM/SIGINT listeners that run the shared shutdown path, with a second signal force-exiting as
   * most CLIs do.
   */
  private static installShutdownHandlers(options: MochiServeOptions, server: Server<undefined>, development: boolean): void {
    shutdownState.server = server;
    shutdownState.options = options;
    shutdownState.development = development;
    let shuttingDown = false;
    const handle = async (signal: NodeJS.Signals): Promise<void> => {
      if (shuttingDown) {
        process.exit(1);
      }
      shuttingDown = true;
      logger.info(`Received ${signal}, shutting down…`);
      await performShutdown(signal);
      // chokidar's dev watchers and any user timer still running would otherwise keep the event loop alive past the last socket.
      process.exit(0);
    };
    process.on('SIGTERM', handle);
    process.on('SIGINT', handle);
  }
}

interface ShutdownState {
  server: Server<undefined> | null;
  options: MochiServeOptions | null;
  development: boolean;
  stopping: Promise<void> | null;
}

// Pinned so `Mochi.stop()` reaches the serve context whichever bundled copy of this module registered it.
const shutdownState = pinGlobal<ShutdownState>('__mochi_shutdown_state__', () => ({
  server: null,
  options: null,
  development: false,
  stopping: null,
}));

async function runShutdown(signal?: NodeJS.Signals): Promise<void> {
  const { server, options } = shutdownState;
  if (!server || !options) {
    // Nothing served in this process — at most a standalone producer queue runtime is up.
    await closeAllQueueResources();
    resetStartupMilestones();
    return;
  }
  try {
    await runHook('mochi:shutdown', signal ? { options, server, signal } : { options, server });
  } catch (err) {
    logger.error(`mochi:shutdown hook failed: ${err instanceof Error ? err.message : err}`);
  }
  await closeAllQueueResources();
  resetStartupMilestones();
  const stopEvent: MochiServerStopEvent = { reason: signal ? 'signal' : 'stop' };
  if (signal === 'SIGTERM' || signal === 'SIGINT') {
    stopEvent.signal = signal;
  }
  mochiEvents.emit('server:stop', stopEvent);

  // A non-forced `stop()` waits for every connection to drain and Bun never resolves it while a WebSocket is open,
  // so in dev a single tab holding the live-reload socket wedges the process; the graceful stop gets the grace
  // period alone, then connections are cut regardless.
  const timeout = options.shutdownTimeout ?? (shutdownState.development ? 0 : 5_000);
  if (timeout > 0) {
    // Once the grace period wins the race, a late rejection from the graceful stop has no one left to await it.
    const graceful = server.stop().catch((err: unknown) => {
      logger.warn(`Graceful stop failed: ${err instanceof Error ? err.message : err}`);
    });
    await Promise.race([graceful, Bun.sleep(timeout)]);
  }
  // Caught so a rejection can't escape the signal handler before its process.exit(0) or skip the clearing below.
  await server.stop(true).catch((err: unknown) => {
    logger.warn(`Forced stop failed: ${err instanceof Error ? err.message : err}`);
  });
  // Cleared so a later stop() takes the no-server path instead of re-firing the hook against a dead server.
  shutdownState.server = null;
  shutdownState.options = null;
}

function performShutdown(signal?: NodeJS.Signals): Promise<void> {
  // Memoized while running so a signal racing a programmatic stop() awaits the same teardown; cleared on settle so a
  // standalone runtime reconnected afterwards (tests) can be stopped again.
  shutdownState.stopping ??= runShutdown(signal).finally(() => {
    shutdownState.stopping = null;
  });
  return shutdownState.stopping;
}
