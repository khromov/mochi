import type { BunFile, Server, ServerWebSocket } from 'bun';
import type { Handle, HandleError, MochiEvent } from './hooks';
import type { MochiCookieJar } from './cookies';
import type { MochiCsrfOptions } from './csrf';
import type { MochiFilters, MochiHooks } from './extensions';
import type { MochiProxyOptions } from './proxy';

export type MochiServerPropsResolver = (req: Request, params: Record<string, string>) => Record<string, unknown> | Promise<Record<string, unknown>>;

export function isServerPropsResolver(serverProps: Record<string, unknown> | MochiServerPropsResolver | undefined): serverProps is MochiServerPropsResolver {
  return typeof serverProps === 'function';
}

export interface MochiPageConfig {
  readonly __mochiPage: true;
  readonly componentPath: string;
  readonly serverProps?: Record<string, unknown> | MochiServerPropsResolver;
  readonly actions?: MochiFormActions;
}

export function isMochiPage(value: unknown): value is MochiPageConfig {
  return typeof value === 'object' && value !== null && (value as MochiPageConfig).__mochiPage === true;
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';

/**
 * The event object passed to API route handlers.
 * Extends MochiEvent with the HTTP method, the resolved route params, and the
 * request's cookie jar.
 */
export interface MochiApiEvent extends MochiEvent {
  /** The HTTP method of the request (GET, POST, PUT, DELETE, etc.). */
  method: HttpMethod;
  /** Resolved route params (e.g. `:id` from `/api/users/:id`). */
  params: Record<string, string>;
  /** The request's cookie jar — read or write cookies on the response. */
  cookies: MochiCookieJar;
}

/**
 * An API route handler function. Receives a `MochiApiEvent` and must return
 * a `Response` (or a promise of one).
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
}

export function isMochiApi(value: unknown): value is MochiApiConfig {
  return typeof value === 'object' && value !== null && (value as MochiApiConfig).__mochiApi === true;
}

export type BunRouteValue =
  | Response
  | BunFile
  | ((req: Request, server: Server<undefined>) => Response | Promise<Response>)
  | Record<string, (req: Request, server: Server<undefined>) => Response | Promise<Response>>;

// ---------------------------------------------------------------------------
// Form actions (attached to Mochi.page() handlers)
// ---------------------------------------------------------------------------

/**
 * Returned by `fail()` — re-renders the entry component with a `form` prop
 * indicating the action failed. The HTTP status code carries over.
 */
export interface MochiFormFail<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly __mochiFormFail: true;
  readonly status: number;
  readonly data: T;
}

/**
 * Returned by `redirect()` — produces an HTTP redirect after the action runs.
 * Use 303 for POST/Redirect/GET after a successful mutation.
 */
export interface MochiFormRedirect {
  readonly __mochiFormRedirect: true;
  readonly status: 301 | 302 | 303 | 307 | 308;
  readonly location: string;
}

/**
 * Returned by `success()` — re-renders the entry component with a `form` prop
 * indicating the action succeeded. Response status is 200.
 */
export interface MochiFormSuccess<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly __mochiFormSuccess: true;
  readonly data: T;
}

/**
 * Any return value allowed from a form action handler. Returning a plain
 * `Response` is an escape hatch.
 */
export type MochiFormActionResult = MochiFormFail | MochiFormRedirect | MochiFormSuccess | Response | void | undefined;

/**
 * The event object passed to form action handlers. Body is already parsed
 * into `formData`. `actionName` is `"default"` unless a `?/name` query is
 * present on the form's action URL.
 */
export interface MochiFormEvent extends MochiEvent {
  method: HttpMethod;
  formData: FormData;
  actionName: string;
  cookies: MochiCookieJar;
  params: Record<string, string>;
}

export type MochiFormActionHandler = (event: MochiFormEvent) => MochiFormActionResult | Promise<MochiFormActionResult>;

/**
 * Map of action name → handler. The `default` entry runs when the form has
 * no `?/name` query string. Other keys are addressed via `action="?/name"`.
 */
export type MochiFormActions = Record<string, MochiFormActionHandler>;

/**
 * The resolved outcome of a form submission, delivered to the component as the
 * `form` prop on POST re-render. `null` on GET requests and on successful
 * redirects (where no re-render happens at all).
 */
export type MochiFormResult = { ok: true; action: string; data: Record<string, unknown> } | { ok: false; action: string; status: number; data: Record<string, unknown> } | null;

// ---------------------------------------------------------------------------
// Enhanced ({@attach enhance(...)}) form submissions — JSON wire format
// ---------------------------------------------------------------------------

/** Generic constraint used for `Success` / `Failure` payloads in enhanced form submissions. */
export type MochiFormShape = Record<string, unknown> | undefined;

/**
 * The JSON envelope returned to a client `{@attach enhance(...)}` submission. Mirrors
 * SvelteKit's `ActionResult` so the wire format is portable. `data` arrives
 * decoded — `enhance` runs `devalue.parse` on the raw string off the wire
 * before invoking the callback.
 */
export type MochiEnhanceResult<Success extends MochiFormShape = MochiFormShape, Failure extends MochiFormShape = MochiFormShape> =
  | { type: 'success'; status: number; data?: Success }
  | { type: 'failure'; status: number; data?: Failure }
  | { type: 'redirect'; status: number; location: string }
  | { type: 'error'; status?: number; error: unknown };

/**
 * The result-handler returned (optionally) from a `MochiSubmitFunction`. If
 * provided, it fully replaces the default fallback for handling the server's
 * `MochiEnhanceResult`.
 */
export type MochiSubmitCallback<Success extends MochiFormShape = MochiFormShape, Failure extends MochiFormShape = MochiFormShape> = (opts: {
  formData: FormData;
  formElement: HTMLFormElement;
  action: URL;
  result: MochiEnhanceResult<Success, Failure>;
  update: (options?: { reset?: boolean }) => Promise<void>;
}) => void | Promise<void>;

/**
 * Options object accepted by `enhance(...)` as an alternative to passing a
 * `MochiSubmitFunction` directly.
 *
 * - `submit` — same as passing a `MochiSubmitFunction` directly (optional).
 * - `onPending` — called with `true` immediately before the fetch begins and
 *   `false` once the result callback has settled (or if the submission was
 *   cancelled). Use it to drive loading/disabled state without managing
 *   `pending` inside the submit function.
 */
export type MochiEnhanceOptions<Success extends MochiFormShape = MochiFormShape, Failure extends MochiFormShape = MochiFormShape> = {
  submit?: MochiSubmitFunction<Success, Failure>;
  onPending?: (pending: boolean) => void;
};

/**
 * The callback signature accepted by `enhance(...)`. Called once per submit;
 * may return a `MochiSubmitCallback` (sync or via `Promise`) to replace the
 * default fallback.
 */
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
   * Absolute path of the page entry that rendered the tab on the other end of
   * this socket — used by the dev live-reload to scope `reload` signals to
   * tabs whose entry was actually affected. Set only on the internal
   * `/__mochi_live_reload` socket; user-defined `Mochi.ws()` routes leave it
   * undefined.
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

// ---------------------------------------------------------------------------
// SSE routes
// ---------------------------------------------------------------------------

export interface MochiSseStream {
  /** Send an SSE event. Optionally specify event type and id. */
  send(data: string, options?: { event?: string; id?: string }): void;
  /** Close the stream. */
  close(): void;
  /** Register a cleanup callback for when the client disconnects. */
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

export type MochiRouteValue = MochiPageConfig | MochiApiConfig | MochiWsConfig | MochiSseConfig | BunRouteValue;

/** `stack` is only populated when the server runs with `development: true`. */
export interface MochiErrorProps {
  error: {
    status: number;
    message: string;
    stack?: string;
  };
}

// ---------------------------------------------------------------------------
// Build manifest
// ---------------------------------------------------------------------------

export interface MochiManifestComponent {
  ssrModule: string;
  hydratables: { name: string; resolvedPath: string }[];
  cssComponents: string[];
}

export interface MochiManifest {
  version: 1;
  /** URL prefix under which framework client assets and the server island endpoint are served. */
  assetPrefix: string;
  bootstrapUrl: string | null;
  componentEntryUrls: Record<string, string>;
  cssFileUrls: Record<string, string>;
  /** Maps URL path → disk path relative to project root */
  clientFiles: Record<string, string>;
  components: Record<string, MochiManifestComponent>;
  stats: {
    outputs: {
      name: string;
      size: number;
      inputs: { path: string; size: number }[];
      imports: string[];
    }[];
  } | null;
  /** Maps server island component name → resolved file path */
  serverIslandPaths?: Record<string, string>;
  /** Maps public URL path → disk path (relative to project root) for static files copied from `public/`. */
  publicFiles?: Record<string, string>;
  /** Maps resolved CSS-import path → served URL (e.g. /import-css/inter-<hash>.css) */
  importedCssUrls?: Record<string, string>;
  /** Maps page entry .svelte path → list of CSS-import paths reachable from it */
  entryImportedCss?: Record<string, string[]>;
}

/**
 * Dependency-injected markdown support. When set on `MochiServeOptions`,
 * Mochi registers `.md` and `.svx` loaders that pipe source through the
 * user-supplied `compile` function (typically `mdsvex`'s) before handing
 * the resulting Svelte source to the Svelte compiler.
 *
 * Omit `markdown` to disable markdown entirely — `.md`/`.svx` imports
 * then surface as a "no loader" error from Bun's bundler.
 *
 * The `compile` signature is structurally typed to match mdsvex without
 * importing from it, so users on a different markdown compiler can wrap
 * it to fit.
 */
/**
 * Highlighter signature accepted by `MarkdownConfig.highlight.highlighter`.
 * The parameter types are widened to match mdsvex's `Highlighter` (so the
 * `compile` function from mdsvex assigns cleanly), but extra params are
 * optional — a `(code, lang) => string` implementation works.
 */
export type MarkdownHighlighter = (code: string, lang?: string | null, metastring?: string | null, filename?: string, optimise?: boolean) => string | Promise<string>;

export interface MarkdownConfig {
  /**
   * The markdown → Svelte source compiler. Signature kept loose (`unknown` in
   * the return position) so mdsvex's `compile` — which declares a nested-Promise
   * return type in its `.d.ts` — assigns cleanly. The loader awaits the result
   * and runtime-checks for `{ code: string }`.
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
   * Syntax highlighter for fenced code blocks. Omit to leave fenced blocks
   * un-highlighted (mdsvex's bare `<pre><code>` output). Plug in Shiki,
   * highlight.js, or any other library by wrapping it in a
   * `(code, lang) => string | Promise<string>` function.
   */
  highlight?: { highlighter: MarkdownHighlighter };
}

// ---------------------------------------------------------------------------
// Serve options
// ---------------------------------------------------------------------------

export interface MochiServeOptions {
  port?: number;
  hostname?: string;
  development?: boolean;
  /**
   * Mount the dev-only debug toolbar (the floating bottom-right bar).
   * Default: `true`. Has no effect when `development` is `false` — the
   * toolbar is dev-only, so setting `debugBar: true` in production does
   * NOT enable it.
   */
  debugBar?: boolean;
  /**
   * Enable the dev-mode live-reload WebSocket that reloads the browser on
   * source changes. Default: matches `development`. Set to `false` to keep
   * the debug bar but skip the WS — useful when shipping the debug bar in
   * a production-like deployment (e.g. Docker demo sites) where the
   * `/__mochi_live_reload` socket is flaky behind a proxy.
   */
  liveReload?: boolean;
  /** Path to a prebuilt manifest JSON. Defaults to `.mochi/manifest.json`. */
  manifest?: string;
  routes?: Record<string, MochiRouteValue>;
  fetch?: (req: Request, server: Server<undefined>) => Response | Promise<Response>;
  htmlShell?: string;
  /**
   * A middleware handle function (or a `sequence()` of them) that wraps every
   * incoming request. Use this to add authentication, logging, headers, etc.
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
   * Built-in request logger configuration. Pass `{ enabled: false }` to
   * disable the formatter while keeping events flowing on the bus, set
   * `level` to gate `log.*` output globally, or override thresholds via
   * `slowThreshold` / `verySlowThreshold`. Enabled by default.
   */
  logger?: {
    enabled?: boolean;
    /**
     * Minimum severity for `log.*` output across the framework (server +
     * client bundles). `'silent'` suppresses everything including BOOT/STOP.
     * Defaults: `'info'` in development, `'warn'` in production.
     */
    level?: import('./log').LogLevel;
  } & import('./consoleLogger').ConsoleLoggerOptions;
  /** Directory served as static assets (cwd-relative). Default: `./public`. */
  publicDir?: string;
  /** Directory for build artifacts and dev cache (cwd-relative). Default: `./.mochi`. */
  outDir?: string;
  /**
   * URL prefix under which framework client assets (JS bundles, CSS, bundle
   * stats page) and the server island endpoint are served. Must start with
   * `/`, must not be the root `/`, must not end with `/`, and must not
   * contain whitespace or `..`. Default: `/_mochi`.
   *
   * In production, the value baked into the prebuilt manifest takes
   * precedence — set this on the `build()` call (or `--asset-prefix` CLI
   * flag) so dev and prod stay in sync.
   */
  assetPrefix?: string;
  /**
   * Path to a module that exports `routes: Record<string, MochiRouteValue>`.
   * In dev mode, changes to this module or its transitive dependencies
   * hot-swap the handler configs for existing route patterns without a restart.
   * Default: auto-discovered from `./src/routes.ts` or `./src/routes.js`.
   */
  routeModule?: string;
  /** Extra paths the dev-mode file watcher monitors, in addition to the defaults `src` and `public`. */
  additionalWatchPaths?: string[];
  /**
   * Path to a Svelte config file (cwd-relative or absolute). Default:
   * `./svelte.config.js`. The file's `compilerOptions` are merged into
   * Mochi's defaults; missing file → defaults only.
   */
  svelteConfigPath?: string;
  /**
   * Dependency-injected markdown (`.md` / `.svx`) support. Pass the `compile`
   * function from `mdsvex` plus any rehype/remark plugins to enable; omit to
   * leave markdown unhandled.
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
   * Origin-header CSRF protection for form-style POST/PUT/PATCH/DELETE
   * requests. Enabled by default — pass `{ checkOrigin: false }` to disable
   * or `{ trustedOrigins: ['https://other.example'] }` to allow extra origins.
   *
   * The check rejects requests whose `Origin` header is missing or doesn't
   * match the expected origin, but only when the `Content-Type` is
   * `application/x-www-form-urlencoded`, `multipart/form-data`, or
   * `text/plain` — the three types a cross-origin `<form>` can submit
   * without a CORS preflight. JSON endpoints rely on the browser's preflight
   * and are not gated here.
   *
   * The expected origin defaults to `url.origin`. Behind a reverse proxy,
   * configure `proxy` (below) so the check compares against the public
   * origin instead.
   */
  csrf?: MochiCsrfOptions;
  /**
   * Reverse-proxy trust configuration. Used to derive the expected origin
   * for the CSRF check and the client IP for `getClientAddress()` from
   * forwarded headers. Only set the header options when the proxy is
   * trusted to overwrite them — clients can spoof these headers otherwise.
   */
  proxy?: MochiProxyOptions;
  /**
   * Trailing-slash policy. When set, every non-asset, non-root user route is
   * registered under both `/foo` and `/foo/`, and requests to the
   * non-canonical form are redirected:
   *
   * - `'never'` — `/foo/` → 301/308 → `/foo`
   * - `'always'` — `/foo` → 301/308 → `/foo/`
   *
   * 301 for GET/HEAD, 308 otherwise. Root `/` and paths with file extensions
   * are never redirected. Default: unset (no canonicalisation).
   */
  trailingSlash?: 'never' | 'always';
  /**
   * Event hooks: run a function at a specific framework moment. One entry per name,
   * no priorities. See `MochiHooks` for available names.
   */
  eventHooks?: MochiHooks;
  /**
   * Filters: replace a framework default value. Receive the existing value
   * and return the new one. One entry per name. See `MochiFilters` for
   * available names.
   */
  filters?: MochiFilters;
  [key: string]: unknown;
}
