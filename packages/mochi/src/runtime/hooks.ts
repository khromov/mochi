import type { Server } from 'bun';

/**
 * What the framework is about to do with the request, fixed at event-construction time even if the handler later throws.
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

/** The event object passed to every middleware handle function. */
export interface MochiEvent {
  request: Request;
  url: URL;
  server: Server<undefined>;
  /** Arbitrary per-request data, for passing information between middleware layers. */
  locals: Record<string, unknown>;
  readonly kind: MochiEventKind;
  /**
   * `true` when this request was issued by route warmup at startup rather than a real client.
   * Branch on it to skip middleware side effects (analytics, rate-limit priming, counters) for synthetic hits.
   */
  readonly isWarmup: boolean;
}

/**
 * Options passed to `resolve()` inside a Handle to customise how the response is produced.
 *
 * Merging behaviour under `sequence()`:
 *  - `transformPage` — applied in **reverse** order (last defined runs
 *    first on the HTML, outermost handler transforms last).
 *  - `filterResponseHeaders` — applied in **forward** order; the first
 *    handler that defines this option wins, subsequent ones are ignored.
 */
export interface MochiResolveOptions {
  /** Transform the HTML body before it is sent; returning `undefined` replaces it with an empty string. */
  transformPage?: (input: { html: string; done: boolean }) => string | undefined | Promise<string | undefined>;

  /**
   * Return `true` to keep a header, `false` to drop it.
   * Only the *first* defined filter in a `sequence()` chain is used.
   */
  filterResponseHeaders?: (name: string, value: string) => boolean;
}

/** Produces the Response for an event, given the resolve options accumulated so far. */
export type MochiResolveFn = (event: MochiEvent, opts?: MochiResolveOptions) => Promise<Response>;

export interface MochiErrorInfo {
  status: number;
  message: string;
}

/**
 * Invoked whenever the framework is about to render the error page — uncaught page/form render errors, unmatched routes,
 * unknown form actions, and malformed form bodies. API routes keep their JSON envelope and skip this hook.
 *
 * - `error` may be `null` when the condition didn't originate from a throw
 *   (e.g. `Unknown form action`, unmatched routes). Inspect it before
 *   forwarding to an error tracker so benign 4xx cases don't page on-call.
 * - Return a `MochiErrorInfo` to override either field, a `Response` to
 *   short-circuit rendering, or `void` to keep the defaults.
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
 * A middleware handle function. Call `resolve(event)` to continue to the next middleware (or the final route
 * handler); mutate the event before resolving and post-process the response after.
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

/**
 * Compose multiple `Handle` functions into one, executed **in order**: the first handle's pre-processing
 * runs first and its post-processing runs last, like nested middleware layers.
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
            return applyHandle(i + 1, event, mergedOpts) as Promise<Response>;
          }

          return resolve(event, mergedOpts);
        },
      });
    }
  };
}

// Composition rules live on `MochiResolveOptions`.
function mergeResolveOptions(parent: MochiResolveOptions, child?: MochiResolveOptions): MochiResolveOptions {
  if (!child) {
    return parent;
  }

  const merged: MochiResolveOptions = {};

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

  merged.filterResponseHeaders = parent.filterResponseHeaders ?? child.filterResponseHeaders;

  return merged;
}

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

      const headers = new Headers(result.headers);
      result = new Response(transformed, {
        status: result.status,
        statusText: result.statusText,
        headers,
      });
    }
  }

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
