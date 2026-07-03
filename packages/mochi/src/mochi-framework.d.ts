// Module-augmentation declarations for the in-Svelte virtual module.
// Inside compiled .svelte / .svelte.[jt]s files Mochi rewrites
// `import ... from 'mochi-framework'` to a build-time virtual module
// exposing these symbols. The `import` line below makes this an
// augmenting declaration so it adds to (rather than replaces) the real
// package's exports.
// TODO: Verify if there is a better way of avoiding issues here
import 'mochi-framework';

declare module 'mochi-framework' {
  /** True when rendering on the server (SSR build). */
  export const isServer: boolean;
  /** True when running in the browser (client build). */
  export const isBrowser: boolean;
  export const DEV: boolean;
  /** True when the server was started with `development: true`. */
  export const isDev: boolean;

  type CookieSerializeOptions = import('./cookies').CookieSerializeOptions;

  interface CookieJar {
    get(name: string): string | undefined;
    getAll(): import('./cookies').Cookie[];
    has(name: string): boolean;
    set(name: string, value: string, options?: CookieSerializeOptions): void;
    delete(name: string, options?: Pick<CookieSerializeOptions, 'path' | 'domain'>): void;
  }

  // `logger`, `LogLevel`, `setLogLevel`, `getLogLevel` are real exports of the
  // package (see ./log and ./index re-exports). They flow into Svelte files
  // automatically via the package's exports map; no augmentation entry needed.

  /**
   * Emit a dev-only warning. On the server, logs via `logger.warn`. On the client,
   * pushes to the Mochi debug bar's warnings panel.
   * TODO: This is messy and generally the logger() functions we already have should probably also push to the debug bar instead of just the console.
   */
  export function devWarn(msg: string): void;

  /** Returns the current request context (server-side only). */
  export function getRequestContext(): import('./requestContext').MochiRequestContext;

  /**
   * Cookie jar for the current request. On the server, reads from the request's
   * Cookie header and tracks Set-Cookie headers for the response. On the client,
   * wraps `document.cookie`. Destructuring on the server captures the current
   * request's jar — don't cache methods across awaits.
   */
  export const cookies: CookieJar;

  /** Route parameters for the current request. Server-only; accessing on the client throws. */
  export const params: Readonly<Record<string, string>>;

  /**
   * URL of the current page.
   *
   * - **Server:** proxies `getRequestContext().url` (the parsed request URL).
   * - **Client:** proxies `new URL(window.location.href)`, constructed fresh on
   *   each property access so it always reflects the current browser URL.
   */
  export const url: URL;

  /** Per-request data set by middleware. Server-only; accessing on the client throws. */
  export const locals: Record<string, unknown>;

  /**
   * Re-exported from `devalue` so `.svelte` files can serialize / deserialize
   * rich-typed values (Date, Map, Set, BigInt, cyclic refs, …) without a
   * separate install. Available in both SSR and client builds.
   */
  export { stringify, parse } from 'devalue';

  /**
   * Internal: registers a hydratable island's props in the per-request dedup
   * registry and returns a stable ref id. The preprocessor injects calls to
   * this helper for `mochi:hydrate` islands; application code should not call
   * it directly. Server-only — the client virtual module exposes a stub that
   * throws.
   */
  export function emitIslandProps(value: unknown): string;

  /**
   * Svelte attachment that progressively enhances a `<form method="POST">`.
   * The server's action handler runs as usual, but the response is a JSON
   * envelope (`MochiEnhanceResult`) instead of a re-rendered HTML page.
   * Browser-only: importing on the server is safe, but invoking throws.
   *
   * ```svelte
   * <form method="POST" {@attach enhance()}>
   * ```
   */
  export function enhance<
    Success extends import('./types').MochiFormShape = import('./types').MochiFormShape,
    Failure extends import('./types').MochiFormShape = import('./types').MochiFormShape,
  >(
    options?: import('./types').MochiSubmitFunction<Success, Failure> | import('./types').MochiEnhanceOptions<Success, Failure>,
  ): import('svelte/attachments').Attachment<HTMLFormElement>;

  /**
   * Decode a raw `ActionResult` JSON envelope from a Mochi enhanced POST
   * response. Useful when rolling your own `onsubmit` instead of using
   * `{@attach enhance(...)}`. Browser-only.
   */
  export function deserialize<
    Success extends import('./types').MochiFormShape = import('./types').MochiFormShape,
    Failure extends import('./types').MochiFormShape = import('./types').MochiFormShape,
  >(text: string): import('./types').MochiEnhanceResult<Success, Failure>;

  /**
   * Resilient `fetch` wrapper with retries, a per-attempt timeout, and an
   * optional `baseUrl`. Isomorphic — usable in SSR and hydrated islands. Passes
   * through to the standard `fetch`/`Response` API.
   */
  export function mochiFetch(input: string | URL | Request, options?: import('./fetch').MochiFetchOptions): Promise<Response>;
}
