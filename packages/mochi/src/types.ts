import type { BunFile, Server, ServerWebSocket } from 'bun';
import type { Handle, HandleError, MochiEvent } from './runtime/hooks';
import type { MochiCookieJar } from './runtime/cookies';
import type { MochiCsrfOptions } from './runtime/csrf';
import type { MochiFilters, MochiHooks } from './extensions';
import type { MochiProxyOptions } from './runtime/proxy';
import type { LocalImageAsset, MochiImageOptions } from './image/types';
import type { MochiEmailOptions } from './email/types';
import type { MochiCaptchaOptions } from './captcha/types';
import type { MochiProcessor, MochiQueueListeners, MochiQueueRuntimeOptions, MochiQueueStorage } from './queue';
import type { MochiRateLimitOptions } from './runtime/rateLimit';
import type { MochiSvelteCompiler } from './compiler/svelteCompilerBackend';
import type { SpeculationRules } from './runtime/speculationRules';

export type MochiServerPropsResolver = (req: Request, params: Record<string, string>) => Record<string, unknown> | MochiRedirect | Promise<Record<string, unknown> | MochiRedirect>;

export function isServerPropsResolver(serverProps: Record<string, unknown> | MochiServerPropsResolver | undefined): serverProps is MochiServerPropsResolver {
  return typeof serverProps === 'function';
}

/**
 * A `mochi:defer mochi:hydrate` island's authored hydration mode, riding inside the encrypted server-island
 * envelope under {@link ALSO_HYDRATE_ENVELOPE_KEY}. The preprocessor and the island endpoint both import it
 * from here so producer and consumer stay in agreement.
 */
export type AlsoHydrateMode = 'eager' | 'visible';

/** Envelope key carrying the {@link AlsoHydrateMode} inside the sealed props. */
export const ALSO_HYDRATE_ENVELOPE_KEY = '__mochi_ah';

export function isAlsoHydrateMode(value: unknown): value is AlsoHydrateMode {
  return value === 'eager' || value === 'visible';
}

export interface MochiPageHandlerConfig {
  serverProps?: Record<string, unknown> | MochiServerPropsResolver;
  actions?: MochiFormActions;
}

export interface MochiPageConfig {
  readonly __mochiPage: true;
  readonly componentPath: string;
  readonly serverProps?: Record<string, unknown> | MochiServerPropsResolver;
  readonly actions?: MochiFormActions;
  /** Per-route rate limit. Overrides the global `rateLimit` serve option; `false` opts this route out. */
  readonly rateLimit?: MochiRateLimitOptions | false;
}

export function isMochiPage(value: unknown): value is MochiPageConfig {
  return typeof value === 'object' && value !== null && (value as MochiPageConfig).__mochiPage === true;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';

/** The event object passed to API route handlers. */
export interface MochiApiEvent extends MochiEvent {
  method: HttpMethod;
  /** Resolved route params (e.g. `:id` from `/api/users/:id`). */
  params: Record<string, string>;
  cookies: MochiCookieJar;
}

/**
 * An API route handler, which must return a `Response` or a promise of one.
 *
 * ```ts
 * Mochi.api(({ method, request, url }) => {
 *   if (method === "GET") {
 *     return new Response("hello");
 *   }
 *   return new Response("Method Not Allowed", { status: 405 });
 * })
 * ```
 */
export type MochiApiHandler = (event: MochiApiEvent) => Response | Promise<Response>;

export interface MochiApiConfig {
  readonly __mochiApi: true;
  readonly handler: MochiApiHandler;
  /** Per-route rate limit. Overrides the global `rateLimit` serve option; `false` opts this route out. */
  readonly rateLimit?: MochiRateLimitOptions | false;
}

export function isMochiApi(value: unknown): value is MochiApiConfig {
  return typeof value === 'object' && value !== null && (value as MochiApiConfig).__mochiApi === true;
}

/** Resolves the disk path of the file to serve for a `Mochi.file()` route. */
export type MochiFileResolver = (req: Request, params: Record<string, string>) => string | Promise<string>;

export interface MochiFileConfig {
  readonly __mochiFile: true;
  readonly source: string | MochiFileResolver;
}

export function isMochiFile(value: unknown): value is MochiFileConfig {
  return typeof value === 'object' && value !== null && (value as MochiFileConfig).__mochiFile === true;
}

export type BunRouteValue =
  | Response
  | BunFile
  | ((req: Request, server: Server<undefined>) => Response | Promise<Response>)
  | Record<string, (req: Request, server: Server<undefined>) => Response | Promise<Response>>;

export interface RouteRegistrationResult {
  bunRouteValue: BunRouteValue;
  type: 'page' | 'api' | 'ws' | 'sse' | 'file';
}

/** Returned by `fail()`; re-renders the entry component with a `form` prop marking the action failed, carrying the HTTP status over. */
export interface MochiFormFail<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly __mochiFormFail: true;
  readonly status: number;
  readonly data: T;
}

/** Returned by `redirect()`; produces an HTTP redirect from a form action or a `serverProps` resolver. Use 303 for POST/Redirect/GET after a successful mutation. */
export interface MochiRedirect {
  readonly __mochiRedirect: true;
  readonly status: 301 | 302 | 303 | 307 | 308;
  readonly location: string;
}

/** Returned by `success()`; re-renders the entry component with a `form` prop marking the action succeeded, with status 200. */
export interface MochiFormSuccess<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly __mochiFormSuccess: true;
  readonly data: T;
}

/** Any return value allowed from a form action handler; a plain `Response` is the escape hatch. */
export type MochiFormActionResult = MochiFormFail | MochiRedirect | MochiFormSuccess | Response | void | undefined;

/**
 * The event object passed to form action handlers, with the body already parsed into `formData`.
 * `actionName` is `"default"` unless a `?/name` query is present on the form's action URL.
 */
export interface MochiFormEvent extends MochiEvent {
  method: HttpMethod;
  formData: FormData;
  actionName: string;
  cookies: MochiCookieJar;
  params: Record<string, string>;
}

export type MochiFormActionHandler = (event: MochiFormEvent) => MochiFormActionResult | Promise<MochiFormActionResult>;

/** Map of action name → handler. The `default` entry runs for a bare form; other keys are addressed via `action="?/name"`. */
export type MochiFormActions = Record<string, MochiFormActionHandler>;

/**
 * The resolved outcome of a form submission, delivered to the component as the `form` prop on POST re-render.
 * `null` on GET requests and on successful redirects, where no re-render happens.
 */
export type MochiFormResult = { ok: true; action: string; data: Record<string, unknown> } | { ok: false; action: string; status: number; data: Record<string, unknown> } | null;

/** Generic constraint used for `Success` / `Failure` payloads in enhanced form submissions. */
export type MochiFormShape = Record<string, unknown> | undefined;

/**
 * The JSON envelope returned to a client `{@attach enhance(...)}` submission, mirroring SvelteKit's `ActionResult`.
 * `data` arrives decoded: `enhance` runs `devalue.parse` on the raw string off the wire before invoking the callback.
 */
export type MochiEnhanceResult<Success extends MochiFormShape = MochiFormShape, Failure extends MochiFormShape = MochiFormShape> =
  | { type: 'success'; status: number; data?: Success }
  | { type: 'failure'; status: number; data?: Failure }
  | { type: 'redirect'; status: number; location: string }
  | { type: 'error'; status?: number; error: unknown };

/** The result-handler optionally returned from a `MochiSubmitFunction`; when present it fully replaces the default handling of `MochiEnhanceResult`. */
export type MochiSubmitCallback<Success extends MochiFormShape = MochiFormShape, Failure extends MochiFormShape = MochiFormShape> = (opts: {
  formData: FormData;
  formElement: HTMLFormElement;
  action: URL;
  result: MochiEnhanceResult<Success, Failure>;
  update: (options?: { reset?: boolean }) => Promise<void>;
}) => void | Promise<void>;

/**
 * Options object accepted by `enhance(...)` as an alternative to passing a `MochiSubmitFunction` directly.
 * `onPending` fires with `true` immediately before the fetch begins and `false` once the result callback
 * settles or the submission is cancelled, so loading state can live outside the submit function.
 */
export type MochiEnhanceOptions<Success extends MochiFormShape = MochiFormShape, Failure extends MochiFormShape = MochiFormShape> = {
  submit?: MochiSubmitFunction<Success, Failure>;
  onPending?: (pending: boolean) => void;
};

/** The callback accepted by `enhance(...)`, called once per submit; it may return a `MochiSubmitCallback` to replace the default handling. */
export type MochiSubmitFunction<Success extends MochiFormShape = MochiFormShape, Failure extends MochiFormShape = MochiFormShape> = (input: {
  action: URL;
  formData: FormData;
  formElement: HTMLFormElement;
  controller: AbortController;
  submitter: HTMLElement | null;
  cancel: () => void;
}) => void | MochiSubmitCallback<Success, Failure> | Promise<void | MochiSubmitCallback<Success, Failure>>;

// ---------------------------------------------------------------------------
// WebSocket routes
// ---------------------------------------------------------------------------

export interface MochiWsHandlers<T = unknown> {
  /**
   * Called during the HTTP upgrade request. Receives the request and route
   * params. Return data to attach to `ws.data`, or `false` to reject the
   * upgrade.
   */
  upgrade?: (req: Request, params: Record<string, string>) => T | false | Promise<T | false>;
  open?: (ws: ServerWebSocket<MochiWsData<T>>) => void | Promise<void>;
  message: (ws: ServerWebSocket<MochiWsData<T>>, message: string | Buffer) => void | Promise<void>;
  close?: (ws: ServerWebSocket<MochiWsData<T>>, code: number, reason: string) => void | Promise<void>;
  drain?: (ws: ServerWebSocket<MochiWsData<T>>) => void | Promise<void>;
}

export interface MochiWsData<T = unknown> {
  __mochiRoutePattern: string;
  __mochiOpenedAt: number;
  __mochiPath: string;
  /**
   * Absolute path of the page entry that rendered the tab on the other end of this socket, letting dev live-reload
   * scope `reload` signals to tabs whose entry was actually affected. Set only on the internal `/__mochi_live_reload` socket.
   */
  __mochiEntry?: string;
  user: T;
}

export interface MochiWsConfig {
  readonly __mochiWs: true;
  readonly handlers: MochiWsHandlers<unknown>;
}

export function isMochiWs(value: unknown): value is MochiWsConfig {
  return typeof value === 'object' && value !== null && (value as MochiWsConfig).__mochiWs === true;
}

export interface MochiSseStream {
  send(data: string, options?: { event?: string; id?: string }): void;
  close(): void;
  /** Runs when the client disconnects. */
  onClose(callback: () => void): void;
}

export type MochiSseHandler = (stream: MochiSseStream, req: Request) => void | Promise<void>;

export interface MochiSseConfig {
  readonly __mochiSse: true;
  readonly handler: MochiSseHandler;
}

export function isMochiSse(value: unknown): value is MochiSseConfig {
  return typeof value === 'object' && value !== null && (value as MochiSseConfig).__mochiSse === true;
}

/**
 * Descriptor returned by `Mochi.queue(name, …)`. Non-generic so a heterogeneous `queues` array type-checks; the
 * `never` parameter slots keep a caller's typed processor/listeners assignable (contravariance) without casts.
 */
export interface MochiQueueConfig {
  readonly __mochiQueue: true;
  readonly name: string;
  readonly process?: MochiProcessor<never, unknown>;
  readonly options?: MochiQueueRuntimeOptions;
  readonly on?: Partial<MochiQueueListeners<never, never>>;
  readonly storage?: MochiQueueStorage;
}

export function isMochiQueue(value: unknown): value is MochiQueueConfig {
  return typeof value === 'object' && value !== null && (value as MochiQueueConfig).__mochiQueue === true;
}

/** Options for `Mochi.worker()` — consume queues in a process that never calls `Mochi.serve()`. */
export interface MochiWorkerOptions {
  queues: MochiQueueConfig[];
  /** The app's queue storage; may instead come from a `storage` declared on the descriptors. */
  storage?: MochiQueueStorage;
}

export type MochiRouteValue = MochiPageConfig | MochiApiConfig | MochiWsConfig | MochiSseConfig | MochiFileConfig | BunRouteValue;

/** `stack` is only populated when the server runs with `development: true`. */
export interface MochiErrorProps {
  error: {
    status: number;
    message: string;
    stack?: string;
  };
}

export interface MochiManifestComponent {
  /** Compiled SSR module path, relative to the build outDir. */
  ssrModule: string;
  /** `resolvedPath` is an encoded source path (see `version`). `exportName` is optional for manifests written before named-export islands existed; absent means `default`. */
  hydratables: { name: string; displayName: string; resolvedPath: string; exportName?: string }[];
  /** Encoded source paths (see `version`) of every component contributing scoped CSS to this entry. */
  cssComponents: string[];
}

export interface MochiManifest {
  /**
   * Schema version of the on-disk build output; the runtime loads only the exact version it writes (currently 2)
   * and throws on anything else, so build and serve must use the same `mochi-framework` version.
   *
   * Every manifest path is relative, in one of three families:
   * - **Artifacts** the runtime opens (`ssrModule`, `clientFiles`,
   *   `localImageAssets[].diskPath`, `serverIslandScript`) — out-dir relative,
   *   resolved against the manifest's own directory.
   * - **Sources** used as lookup keys (`components` keys, `hydratables[].resolvedPath`,
   *   `cssComponents`, `cssFileUrls` keys, `serverIslandPaths`, `importedCssUrls` keys,
   *   `entryImportedCss` keys and values) — POSIX, project-root relative, with framework-owned
   *   sources under a `$mochi/` sentinel. Both ends take the root from `process.cwd()`, so
   *   `mochi-framework build` and the server must run from the same working directory.
   * - **`stats.outputs[].inputs[].path`** — build-cwd relative, as Bun's metafile emits it, and diagnostic only.
   *
   * Static files form no family: the runtime rescans `publicDir` at startup in every mode, and a manifest carries only
   * the count — see `publicFileCount`.
   */
  version: number;
  /** URL prefix under which framework client assets and the server island endpoint are served. */
  assetPrefix: string;
  bootstrapUrl: string | null;
  componentEntryUrls: Record<string, string>;
  /** Maps encoded source path (see `version`) → the URL of that component's scoped CSS. */
  cssFileUrls: Record<string, string>;
  /** Maps URL path → disk path relative to the build outDir. */
  clientFiles: Record<string, string>;
  /** Keyed by encoded source path (see `version`). */
  components: Record<string, MochiManifestComponent>;
  stats: {
    outputs: {
      name: string;
      size: number;
      inputs: { path: string; size: number }[];
      imports: string[];
    }[];
  } | null;
  /** Maps server island component name → its encoded source path (see `version`). */
  serverIslandPaths?: Record<string, string>;
  /** Maps server island component name → the named export it renders (default-export islands are omitted). */
  serverIslandExports?: Record<string, string>;
  /** Maps served asset URL → emitted asset details for locally-imported images (`import x from './x.png'`). `diskPath` is outDir-relative. */
  localImageAssets?: Record<string, LocalImageAsset>;
  /** Maps encoded CSS-import source path (see `version`) → served URL (e.g. /import-css/inter-<hash>.css) */
  importedCssUrls?: Record<string, string>;
  /** Maps encoded page entry path (see `version`) → the CSS-import paths reachable from it, likewise encoded. */
  entryImportedCss?: Record<string, string[]>;
  /** Prebuilt, minified ServerIsland inline web-component script, emitted by `build()` so production loads it from disk in place of a startup `Bun.build`. */
  serverIslandScript?: string;
  /**
   * How many files `publicDir` held at build time — a count rather than a path family, so it stays machine-independent.
   * The build copies no static files, so nothing else in the out-dir would reveal a deploy that shipped the build output
   * and left `publicDir` behind; `Mochi.serve()` compares this against its own startup scan.
   */
  publicFileCount?: number;
}

/**
 * Highlighter signature accepted by `MarkdownConfig.highlight.highlighter`.
 * Extra params are optional, so a `(code, lang) => string` implementation works.
 */
export type MarkdownHighlighter = (code: string, lang?: string | null, metastring?: string | null, filename?: string, optimise?: boolean) => string | Promise<string>;

/**
 * Dependency-injected markdown support. When set on `MochiServeOptions`, Mochi registers `.md` and `.svx` loaders
 * that pipe source through `compile` (typically `mdsvex`'s) before handing the result to the Svelte compiler.
 * Omit `markdown` and `.md`/`.svx` imports surface as a "no loader" error from Bun's bundler.
 */
export interface MarkdownConfig {
  /**
   * The markdown → Svelte source compiler. The return position is `unknown` so mdsvex's `compile`, which declares a
   * nested-Promise return type, assigns cleanly; the loader awaits the result and runtime-checks for `{ code: string }`.
   */
  compile: (
    source: string,
    options: {
      filename: string;
      extensions: string[];
      rehypePlugins?: unknown[];
      remarkPlugins?: unknown[];
      highlight?: { highlighter: MarkdownHighlighter };
    },
  ) => PromiseLike<unknown>;
  /** Rehype plugins forwarded to `compile`. Pass `rehype-slug`, `rehype-autolink-headings`, etc. */
  rehypePlugins?: unknown[];
  /** Remark plugins forwarded to `compile`. */
  remarkPlugins?: unknown[];
  /**
   * Syntax highlighter for fenced code blocks; omit for mdsvex's bare `<pre><code>` output.
   * Wrap Shiki, highlight.js, or any other library in a `(code, lang) => string | Promise<string>` function.
   */
  highlight?: { highlighter: MarkdownHighlighter };
}

/**
 * Per-mode route warmup control. Use this object form instead of a plain
 * `boolean` when warmup should differ between dev and prod — e.g. skip the
 * extra startup work while developing but warm every route in production.
 */
export interface MochiWarmupOptions {
  /** Warm routes when running in production (`development: false`). */
  enabledInProd: boolean;
  /** Warm routes when running in development (`development: true`). */
  enabledInDev: boolean;
}

/** Keys the framework sets on `Bun.serve()` itself; rejected under `bun` and stripped from `BunServeOverrides`. */
export const FRAMEWORK_OWNED_BUN_KEYS = ['fetch', 'websocket', 'routes', 'error'] as const;

/**
 * Options spread directly into the underlying `Bun.serve()`. The framework owns
 * the keys in {@link FRAMEWORK_OWNED_BUN_KEYS}; setting any of them here throws.
 */
export type BunServeOverrides = Omit<NonNullable<Parameters<typeof Bun.serve>[0]>, (typeof FRAMEWORK_OWNED_BUN_KEYS)[number]>;

export interface MochiServeOptions {
  port?: number;
  hostname?: string;
  /**
   * Escape hatch for raw `Bun.serve()` options Mochi doesn't surface — e.g.
   * `idleTimeout` (seconds; HTTP default 10, max 255, 0 disables), `maxRequestBodySize`,
   * `reusePort`, `tls`. Spread into `Bun.serve()`; framework-owned keys are rejected.
   */
  bun?: BunServeOverrides;
  development?: boolean;
  /** Mount the dev-only debug toolbar. Default: `true`, and ignored entirely when `development` is `false`. */
  debugBar?: boolean;
  /**
   * Enable the dev-mode live-reload WebSocket that reloads the browser on source changes. Default: matches `development`.
   * Set `false` to keep the debug bar without the socket, for production-like deployments where `/__mochi_live_reload` is flaky behind a proxy.
   */
  liveReload?: boolean;
  /**
   * Grace period (ms) on `SIGTERM`/`SIGINT` for in-flight requests to finish before connections are force-closed.
   * Default: `5000` in production, `0` in development, where `0` force-closes immediately. A non-forced `server.stop()`
   * never resolves while a WebSocket is open, so the forced fallback keeps one live-reload tab from wedging the process.
   */
  shutdownTimeout?: number;
  /** Path to a prebuilt manifest JSON. Defaults to `.mochi/manifest.json`. */
  manifest?: string;
  routes?: Record<string, MochiRouteValue>;
  /**
   * Background job queues to start with the server: an array of `Mochi.queue(name, { process, … })` descriptors.
   * Add jobs via the descriptor itself or `Mochi.getQueue(name)`. Queues drain gracefully on shutdown.
   */
  queues?: MochiQueueConfig[];
  /**
   * Where queue jobs live: `'memory'` (default — lost on restart), `{ sqlite: 'path/to.db' }` for a durable
   * single-process store, `{ postgres: url }` for a shared multi-process store (installed into a `mochi_queue` schema),
   * or `{ pglite: instance }` for an embedded in-process Postgres you construct and own (Mochi never closes it).
   * Unset, it inherits a `storage` declared on the queue descriptors; an app has one queue storage, so conflicting
   * declarations are a boot error.
   */
  queueStorage?: MochiQueueStorage;
  fetch?: (req: Request, server: Server<undefined>) => Response | Promise<Response>;
  htmlShell?: string;
  /**
   * Speculation Rules injected as a `<script type="speculationrules">` tag into every rendered page's `<head>`, so
   * the browser can prefetch/prerender same-site URLs and make navigations feel instant. An omitted option — or an
   * object whose `prefetch` and `prerender` are both empty or absent — injects nothing. Generate a starting config
   * from your routes with `mochi-framework speculation-rules`.
   */
  speculationRules?: SpeculationRules;
  /**
   * A middleware handle function (or a `sequence()` of them) wrapping every incoming request — authentication, logging, headers.
   *
   * ```ts
   * import { sequence } from './mochi-framework/hooks';
   *
   * await Mochi.serve({
   *   handle: sequence(auth, logging),
   *   routes: { ... },
   * });
   * ```
   */
  handle?: Handle;
  /** Path to a Svelte component rendered for uncaught page/form errors and unmatched routes. Default: built-in minimal error page. */
  errorPage?: string;
  /** Hook invoked before rendering the error page; may override status/message or return a `Response` to take over. See `HandleError`. */
  handleError?: HandleError;
  /** Deflate-compress server island props when it reduces size. Default: true. */
  compressServerIslandProps?: boolean;
  /**
   * Render nested `mochi:defer` islands in-process during an island fetch instead of emitting further client fetches,
   * collapsing an N-level chain into one request. `mochi:defer:visible` children always keep their own lazy fetch, and a
   * single call site opts out with `mochi:defer={{ inline: false }}`. Default: true.
   */
  inlineNestedIslands?: boolean;
  /**
   * Built-in request logger, enabled by default. `{ enabled: false }` disables the formatter while events keep flowing
   * on the bus; `level` gates `log.*` output globally; `slowThreshold` / `verySlowThreshold` override the timing bands.
   */
  logger?: {
    enabled?: boolean;
    /**
     * Minimum severity for `log.*` output across server and client bundles, where `'silent'` suppresses even BOOT/STOP.
     * Defaults: `'info'` in development, `'warn'` in production.
     */
    level?: import('./utils/log').LogLevel;
  } & import('./dev/consoleLogger').ConsoleLoggerOptions;
  /** Directory served as static assets (cwd-relative). Default: `./public`. */
  publicDir?: string;
  /**
   * Base directory for build artifacts and dev cache (cwd-relative). Default: `./.mochi`.
   * Production writes here directly while development nests under `<outDir>/dev`, keeping the two modes separate.
   */
  outDir?: string;
  /**
   * URL prefix serving framework client assets (JS bundles, CSS, the bundle stats page) and the server island endpoint.
   * Must start with `/`, be deeper than the root, end without a slash, and contain no whitespace or `..`. Default: `/_mochi`.
   * In production the value baked into the prebuilt manifest wins, so set it on the `build()` call or `--asset-prefix` flag.
   */
  assetPrefix?: string;
  /** Extra paths the dev-mode file watcher monitors, in addition to the defaults `src` and `public`. */
  additionalWatchPaths?: string[];
  /**
   * Path to a Svelte config file (cwd-relative or absolute). Default: `./svelte.config.js`.
   * Its `compilerOptions` merge into Mochi's defaults; a missing file leaves the defaults in place.
   */
  svelteConfigPath?: string;
  /**
   * Which compiler emits component JS. Default `'svelte'`. `'rsvelte'` routes `compile`/`compileModule` through the Rust
   * port and requires the optional `@mochi-framework/rsvelte` package, warning and falling back to `'svelte'` if it won't
   * load; island parsing and preprocessing always use official Svelte. Override with `MOCHI_SVELTE_COMPILER=svelte|rsvelte`.
   */
  svelteCompiler?: MochiSvelteCompiler;
  /**
   * Dependency-injected markdown (`.md` / `.svx`) support — pass `mdsvex`'s `compile` plus any rehype/remark plugins to enable.
   *
   * ```ts
   * import { compile as mdsvexCompile } from 'mdsvex';
   * import rehypeSlug from 'rehype-slug';
   *
   * await Mochi.serve({
   *   markdown: { compile: mdsvexCompile, rehypePlugins: [rehypeSlug] },
   *   routes,
   * });
   * ```
   */
  markdown?: MarkdownConfig;
  /**
   * Origin-header CSRF protection for form-style POST/PUT/PATCH/DELETE requests, enabled by default. Pass
   * `{ checkOrigin: false }` to disable or `{ trustedOrigins: ['https://other.example'] }` to allow extra origins.
   *
   * A request is rejected when its `Origin` header is missing or mismatched, and only for the three content types a
   * cross-origin `<form>` can submit without a CORS preflight: `application/x-www-form-urlencoded`, `multipart/form-data`,
   * and `text/plain`. JSON endpoints are covered by the browser's preflight instead.
   *
   * The expected origin defaults to `url.origin`; behind a reverse proxy, configure `proxy` so it compares against the public origin.
   */
  csrf?: MochiCsrfOptions;
  /**
   * Reverse-proxy trust configuration, deriving the expected CSRF origin and `getClientAddress()`'s client IP from forwarded headers.
   * Set the header options only when the proxy is trusted to overwrite them, since clients can otherwise spoof them.
   */
  proxy?: MochiProxyOptions;
  /**
   * Trailing-slash policy. When set, every non-asset, non-root user route is registered under both `/foo` and `/foo/`,
   * and the non-canonical form redirects:
   *
   * - `'never'` — `/foo/` → 301/308 → `/foo`
   * - `'always'` — `/foo` → 301/308 → `/foo/`
   *
   * 301 for GET/HEAD, 308 otherwise, leaving root `/` and paths with file extensions alone. Default: unset.
   */
  trailingSlash?: 'never' | 'always';
  /**
   * Global rate limit applied to every page and API route, a thin shim around `@joint-ops/hitlimit-bun`. Routes inheriting
   * this option share one limiter, one bucket per key (default: the proxy-aware client IP). A route's own `rateLimit` replaces it.
   */
  rateLimit?: MochiRateLimitOptions;
  /** Event hooks: run a function at a specific framework moment. One entry per name, no priorities. See `MochiHooks` for available names. */
  eventHooks?: MochiHooks;
  /** Filters: receive a framework default value and return its replacement. One entry per name. See `MochiFilters` for available names. */
  filters?: MochiFilters;
  /**
   * Warm the SSR render pipeline at startup by invoking every static page route once through its real handler — `serverProps`,
   * Svelte SSR, and shell assembly — so the first real request skips the cold start. Routes with `:param` or `*` segments are skipped.
   *
   * Pass `true` to warm in **production only**, or a `MochiWarmupOptions` object for per-mode control. Warmup is fire-and-forget:
   * the server accepts traffic immediately and a `warmup:complete` event fires once the batch finishes. Default: `false`.
   */
  warmup?: boolean | MochiWarmupOptions;
  /**
   * On-the-fly image transforms via named sizes, mounting a signed `/_mochi/image/*` endpoint behind `getImageUrl()` and `<Image>`.
   * Every served URL's payload is encrypted, so arbitrary sources and transforms stay unreachable. Default: enabled; pass
   * `{ enabled: false }` to turn it off. See `MochiImageOptions`.
   */
  image?: MochiImageOptions;
  /**
   * Transactional email: configures `Mochi.email(...)` with a default `from` and a pluggable `transport` — SMTP, a custom-send
   * function for HTTP email APIs, or the default `log` transport, which logs in place of sending. See `MochiEmailOptions`.
   */
  email?: MochiEmailOptions;
  /**
   * Slide-to-verify captcha backing `mintCaptcha()` / `verifyCaptcha()` and the `<MochiCaptcha>` component, tuning proof-of-work
   * difficulty, the token timing floor and expiry, and the one-time nonce store used for replay protection. See `MochiCaptchaOptions`.
   * Default: 16 bits, a 2s floor, a 15-minute expiry, and an in-memory nonce store.
   */
  captcha?: MochiCaptchaOptions;
  /**
   * Run the whole-program [svelte-shaker](https://github.com/baseballyama/svelte-shaker) pass before compiling, slimming
   * `.svelte` source (prop folding, dead-branch removal, CSS narrowing) so the Svelte compiler emits less code.
   *
   * **Production only**, since shaking is whole-program and per-file HMR can't safely reuse a one-time shake; the scan covers
   * `./src`. `mochi-framework build` reads this straight from your entry's `Mochi.serve()` call, keeping the manifest in sync.
   *
   * Pass `true` to shake everything, or an object with `enabled: true` plus `exclude`. Default: `false`.
   *
   * Requires the optional `@mochi-framework/svelte-shaker` package (`bun add -d @mochi-framework/svelte-shaker`); without
   * it Mochi warns once at boot and compiles from the original sources.
   */
  optimize?: boolean | MochiSvelteShakerOptions;
  /**
   * Warning when a dependency drags a large module into the build graph that is then almost entirely tree-shaken away — the
   * "barrel import" smell, e.g. `import { Sun } from '@lucide/svelte'` in place of `@lucide/svelte/icons/sun`. Bun re-parses
   * that re-export file on every rebuild, so it slows HMR even though little of it ships. Dev fires once per package; a
   * production build collapses offenders into one summary line. Default: enabled.
   *
   * - `false` — silence the warning entirely.
   * - `{ ignore: ['pkg-name'] }` — suppress specific packages you can't fix.
   * - `{ minBytes: 102400 }` — override the parsed-size threshold (default 50 KB).
   */
  barrelWarnings?: boolean | MochiBarrelWarningOptions;
  /**
   * Output controls for `mochi-framework build`, read from your entry alongside `optimize` and `barrelWarnings`.
   * The runtime itself ignores this field.
   */
  build?: MochiBuildReportOptions;
  [key: string]: unknown;
}

/** Object form of `MochiServeOptions['build']`. See that field for semantics. */
export interface MochiBuildReportOptions {
  /** Print the emitted-resources list, one row per local image import with dimensions and size on disk. The summary line keeps its asset count either way. Default: enabled. */
  resources?: boolean;
}

/** Object form of `MochiServeOptions['barrelWarnings']`. See that field for semantics. */
export interface MochiBarrelWarningOptions {
  /** Packages to exclude from the heavy-barrel warning (e.g. ones you can't fix). */
  ignore?: string[];
  /** Parsed-size threshold in bytes before a dependency file is considered. Default: 50 KB. */
  minBytes?: number;
}

export interface MochiSvelteShakerOptions {
  /** When `false`, shaking is skipped even though an options object is present, keeping `exclude` config visible while the pass is off. */
  enabled: boolean;
  /**
   * Glob patterns (cwd-relative) of `.svelte` files that compile from their original source instead of svelte-shaker's output,
   * to dodge a component the shaker mis-transforms (e.g. a `class:` shorthand on a folded prop). Scoped to the listed files alone.
   * Example: `['src/components/ThemeToggle.svelte', 'src/legacy/**']`.
   */
  exclude?: string[];
}
