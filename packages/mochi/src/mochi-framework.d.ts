// Inside compiled .svelte / .svelte.[jt]s files Mochi rewrites `import ... from 'mochi-framework'` to a build-time
// virtual module exposing these symbols. The `import` line below makes this an augmenting declaration, so it adds to
// the real package's exports rather than replacing them.
// TODO: Verify if there is a better way of avoiding issues here
import 'mochi-framework';

declare module 'mochi-framework' {
  // `isServer` / `isBrowser` / `isDev` are real exports of `utils/env.ts`; augmenting them here would duplicate them.

  type CookieSerializeOptions = import('./runtime/cookies').CookieSerializeOptions;

  interface CookieJar {
    get(name: string): string | undefined;
    getAll(): import('./runtime/cookies').Cookie[];
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
  export function getRequestContext(): import('./runtime/requestContext').MochiRequestContext;

  /**
   * Cookie jar for the current request: on the server it reads the request's Cookie header and tracks Set-Cookie for
   * the response, on the client it wraps `document.cookie`. Server-side destructuring captures the current request's
   * jar, so keep methods out of anything that outlives an await.
   */
  export const cookies: CookieJar;

  /** Route parameters for the current request. Server-only; accessing on the client throws. */
  export const params: Readonly<Record<string, string>>;

  /**
   * URL of the current page: on the server it proxies `getRequestContext().url`, on the client
   * `new URL(window.location.href)`, rebuilt on each property access so it tracks the live browser URL.
   */
  export const url: URL;

  /** Per-request data set by middleware. Server-only; accessing on the client throws. */
  export const locals: Record<string, unknown>;

  /** Re-exported from `devalue` so `.svelte` files can round-trip rich-typed values (Date, Map, Set, BigInt, cyclic refs) with no separate install, in both SSR and client builds. */
  export { stringify, parse } from 'devalue';

  /**
   * Internal: registers a hydratable island's props in the per-request dedup registry and returns a stable ref id. The
   * preprocessor injects the calls for `mochi:hydrate` islands, and the client virtual module stubs it with a throw.
   */
  export function emitIslandProps(value: unknown): string;

  /**
   * Svelte attachment that progressively enhances a `<form method="POST">`. The server's action handler runs as usual
   * while the response becomes a JSON envelope (`MochiEnhanceResult`) in place of a re-rendered HTML page.
   * Browser-only: importing on the server is safe, invoking throws.
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

  /** Decode a raw `ActionResult` JSON envelope from a Mochi enhanced POST response, for rolling your own `onsubmit` instead of `{@attach enhance(...)}`. Browser-only. */
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
