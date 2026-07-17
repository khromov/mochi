import type { Server } from 'bun';

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/**
 * Discriminator for `MochiEvent.kind` describing what the framework is
 * about to do with the request. Set once at event-construction time and
 * does not change if the underlying handler later throws.
 *
 *  - `'page'`     — handled by `Mochi.page` (GET render or POST form action)
 *  - `'api'`      — handled by `Mochi.api`
 *  - `'asset'`    — framework static asset: `/_mochi/client/*.js|.css` bundle
 *                   or the `/_mochi/client/stats` dev endpoint
 *  - `'fallback'` — unmatched URL that will be passed to the user's `fetch`
 *  - `'error'`    — unmatched URL with no `fetch` configured; the framework
 *                   error responder will render a 404
 */
export type MochiEventKind = 'page' | 'api' | 'asset' | 'fallback' | 'error';

/**
 * The event object passed to every middleware handle function.
 * Wraps a Bun Request with additional context.
 */
export interface MochiEvent {
  /** The incoming HTTP request. */
  request: Request;
  /** Parsed URL of the request. */
  url: URL;
  /** The Bun server instance. */
  server: Server<undefined>;
  /**
   * Arbitrary per-request data that middleware can read/write.
   * Use this to pass information between middleware layers.
   */
  locals: Record<string, unknown>;
  /** What the framework is about to do with this request. */
  readonly kind: MochiEventKind;
  /**
   * `true` when this request was issued by route warmup at startup rather than
   * a real client. Branch on it to skip middleware side effects (analytics,
   * rate-limit priming, counters) for synthetic warmup hits.
   */
  readonly isWarmup: boolean;
}

/**
 * Options that can be passed to `resolve()` inside a Handle to customise
 * how the response is produced.
 *
 * Merging behaviour when using `sequence()`:
 *  - `transformPage` — applied in **reverse** order (last defined runs
 *    first on the HTML, outermost handler transforms last).
 *  - `filterResponseHeaders` — applied in **forward** order; the first
 *    handler that defines this option wins, subsequent ones are ignored.
 */
export interface MochiResolveOptions {
  /**
   * Transform the HTML body before it is sent.
   * Return `undefined` to replace with an empty string.
   */
  transformPage?: (input: { html: string; done: boolean }) => string | undefined | Promise<string | undefined>;

  /**
   * Filter which headers are included in the response.
   * Return `true` to keep the header, `false` to drop it.
   * Only the *first* defined filter in a `sequence()` chain is used.
   */
  filterResponseHeaders?: (name: string, value: string) => boolean;
}

/**
 * A resolve function: takes the (possibly modified) event and optional
 * resolve options, and produces a Response.
 */
export type MochiResolveFn = (event: MochiEvent, opts?: MochiResolveOptions) => Promise<Response>;

export interface MochiErrorInfo {
  status: number;
  message: string;
}

/**
 * Invoked whenever the framework is about to render the error page —
 * uncaught page/form render errors, unmatched routes, unknown form actions,
 * and malformed form bodies. Not called for API routes, which keep their
 * JSON envelope.
 *
 * - `error` may be `null` when the condition didn't originate from a throw
 *   (e.g. `Unknown form action`, unmatched routes). Inspect it before
 *   forwarding to an error tracker so benign 4xx cases don't page on-call.
 * - Return a `MochiErrorInfo` (`{ status, message }`) to override either
 *   field, a `Response` to short-circuit rendering entirely (useful for
 *   redirects or custom responses), or `void` / `undefined` to keep the
 *   defaults.
 * - If the hook itself throws, the framework logs it and falls back to
 *   the original status/message.
 */
export type HandleError = (input: {
  error: unknown;
  event: MochiEvent;
  status: number;
  message: string;
}) => Response | MochiErrorInfo | void | Promise<Response | MochiErrorInfo | void>;

/**
 * A middleware handle function, analogous to SvelteKit's `Handle`.
 *
 * Receives the current event and a `resolve` callback. Call `resolve(event)`
 * to continue to the next middleware (or the final route handler). You can
 * modify the event before resolving, and post-process the response after.
 *
 * ```ts
 * const myHandle: Handle = async ({ event, resolve }) => {
 *   console.log('before');
 *   const response = await resolve(event);
 *   console.log('after');
 *   return response;
 * };
 * ```
 */
export type Handle = (input: { event: MochiEvent; resolve: MochiResolveFn }) => Response | Promise<Response>;

// ---------------------------------------------------------------------------
// sequence()
// ---------------------------------------------------------------------------

/**
 * Compose multiple `Handle` functions into a single `Handle`.
 *
 * Handles are executed **in order**: the first handle's pre-processing runs
 * first, and its post-processing runs last (like nested middleware layers).
 *
 * Resolve-option merging follows the same rules as SvelteKit:
 *  - `transformPage` is applied in **reverse** order (inner-most first).
 *  - `filterResponseHeaders` uses **first-defined-wins** semantics.
 *
 * ```ts
 * import { sequence } from './hooks';
 * export const handle = sequence(auth, logging, rateLimit);
 * ```
 */
export function sequence(...handlers: Handle[]): Handle {
  if (handlers.length === 0) {
    return ({ event, resolve }) => resolve(event);
  }

  if (handlers.length === 1) {
    return handlers[0]!;
  }

  return function sequencedHandler({ event, resolve }) {
    return applyHandle(0, event, {});

    function applyHandle(i: number, event: MochiEvent, parentOpts: MochiResolveOptions): Response | Promise<Response> {
      const handle = handlers[i]!;

      return handle({
        event,
        resolve(event, opts) {
          const mergedOpts = mergeResolveOptions(parentOpts, opts);

          if (i < handlers.length - 1) {
            // Continue to the next handle in the chain
            return applyHandle(i + 1, event, mergedOpts) as Promise<Response>;
          }

          // Last handle — call the original resolve with merged options
          return resolve(event, mergedOpts);
        },
      });
    }
  };
}

// ---------------------------------------------------------------------------
// Resolve-option merging
// ---------------------------------------------------------------------------

/**
 * Merge two sets of resolve options according to the composition rules:
 *  - `transformPage`: child runs first, parent wraps (reverse order)
 *  - `filterResponseHeaders`: parent (earlier in sequence) wins
 */
function mergeResolveOptions(parent: MochiResolveOptions, child?: MochiResolveOptions): MochiResolveOptions {
  if (!child) {
    return parent;
  }

  const merged: MochiResolveOptions = {};

  // transformPage — reverse order: child (inner) transforms first,
  // then parent (outer) transforms the result.
  if (parent.transformPage || child.transformPage) {
    merged.transformPage = async (input) => {
      let html = input.html;

      if (child.transformPage) {
        html = (await child.transformPage({ html, done: input.done })) ?? '';
      }

      if (parent.transformPage) {
        html = (await parent.transformPage({ html, done: input.done })) ?? '';
      }

      return html;
    };
  }

  // filterResponseHeaders — first defined wins (parent was defined earlier)
  merged.filterResponseHeaders = parent.filterResponseHeaders ?? child.filterResponseHeaders;

  return merged;
}

// ---------------------------------------------------------------------------
// applyResolveOptions — used by the framework to apply options to a Response
// ---------------------------------------------------------------------------

/**
 * Apply the merged `MochiResolveOptions` to a Response.
 *
 * 1. If `transformPage` is set and the response body is HTML, the
 *    transform is applied to the full HTML string.
 * 2. If `filterResponseHeaders` is set, headers that don't pass the filter
 *    are removed from the response.
 */
export async function applyResolveOptions(response: Response, opts: MochiResolveOptions | undefined): Promise<Response> {
  if (!opts) {
    return response;
  }

  let result = response;

  if (opts.transformPage) {
    const contentType = result.headers.get('Content-Type') ?? '';
    if (contentType.includes('text/html')) {
      const html = await result.text();
      const transformed = (await opts.transformPage({ html, done: true })) ?? '';

      // Rebuild the response preserving status + filtered headers
      const headers = new Headers(result.headers);
      result = new Response(transformed, {
        status: result.status,
        statusText: result.statusText,
        headers,
      });
    }
  }

  // Apply filterResponseHeaders
  if (opts.filterResponseHeaders) {
    const filtered = new Headers();
    for (const [name, value] of result.headers.entries()) {
      if (opts.filterResponseHeaders(name, value)) {
        filtered.set(name, value);
      }
    }
    result = new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: filtered,
    });
  }

  return result;
}
