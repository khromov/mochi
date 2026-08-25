import type { ComponentRegistry, RenderResult } from '../compiler/ComponentRegistry';
import type { HandleError, MochiErrorInfo, MochiEvent, MochiResolveOptions } from './hooks';
import { applyResolveOptions } from './hooks';
import { logger } from '../utils/log';
import { MochiHttpError } from '../utils';
import { getClientAddress, type MochiProxyOptions } from './proxy';
import { requestContext, type MochiRequestContext } from './requestContext';
import { finalizeCookieHeaders, MochiCookieJar, type CookieSerializeOptions } from './cookies';

export const DEFAULT_ERROR_PAGE_PATH = Bun.fileURLToPath(new URL('../templates/DefaultError.svelte', import.meta.url));

export interface ErrorResponderDeps {
  handleError: HandleError | undefined;
  development: boolean;
  registry: ComponentRegistry;
  errorPagePath: string;
  renderShell: (result: RenderResult) => string;
  cookieDefaults: CookieSerializeOptions;
  newRequestId: (req: Request) => string;
  proxy: MochiProxyOptions | undefined;
}

export type RenderErrorResponse = (input: {
  req: Request;
  event: MochiEvent;
  resolveOpts: MochiResolveOptions | undefined;
  status: number;
  message: string;
  thrown: unknown;
}) => Promise<Response>;

export type RouteErrorResponse = (req: Request, event: MochiEvent, resolveOpts: MochiResolveOptions | undefined, err: unknown) => Promise<Response>;

/**
 * Runs the user's `handleError` hook and normalizes its Response-vs-info-vs-void protocol, shared by the HTML error
 * renderer and the enhanced JSON path so validation and invalid-override logging can't diverge. A short-circuit
 * Response is returned verbatim — callers apply their own post-processing (resolve options, JSON envelope).
 */
export async function resolveErrorOverride(
  handleError: HandleError | undefined,
  err: unknown,
  event: MochiEvent,
  status: number,
  message: string,
): Promise<Response | { status: number; message: string }> {
  if (!handleError) {
    return { status, message };
  }
  let override: Response | MochiErrorInfo | void;
  try {
    override = await handleError({ error: err, event, status, message });
  } catch (hookErr) {
    logger.error('handleError hook threw:', hookErr);
    override = undefined;
  }
  if (override instanceof Response) {
    return override;
  }
  if (override && typeof override === 'object') {
    if (typeof override.status === 'number' && typeof override.message === 'string') {
      return { status: override.status, message: override.message };
    }
    logger.error('handleError returned invalid override; expected { status: number, message: string } or a Response, got:', override);
  }
  return { status, message };
}

export function createErrorResponder(deps: ErrorResponderDeps): {
  renderErrorResponse: RenderErrorResponse;
  routeErrorResponse: RouteErrorResponse;
} {
  const { handleError, development, registry, errorPagePath, renderShell, cookieDefaults, newRequestId, proxy } = deps;

  // The unmatched-route 404 fallback renders outside any request context, which would make an
  // error page that calls getRequestContext() (or renders <ViewTransitions />) throw — so build a
  // minimal context here whenever none is ambient.
  const renderErrorResponse: RenderErrorResponse = async (input) => {
    if (requestContext.getStore()) {
      return renderErrorResponseInner(input);
    }
    const ctx: MochiRequestContext = {
      requestId: newRequestId(input.req),
      request: input.req,
      url: input.event.url,
      params: {},
      locals: input.event.locals,
      isWarmup: false,
      cookies: new MochiCookieJar(input.req.headers.get('Cookie'), cookieDefaults),
      islandProps: new Map(),
      // Wired like buildRequestContext's, so an error page sees the same client address on a 404 as on a 500.
      getClientAddress: () => getClientAddress(input.req, input.event.server.requestIP(input.req)?.address ?? null, proxy),
    };
    return requestContext.run(ctx, async () => finalizeCookieHeaders(await renderErrorResponseInner(input), ctx.cookies));
  };

  const renderErrorResponseInner: RenderErrorResponse = async (input) => {
    const { req, event, resolveOpts, thrown } = input;
    let { status, message } = input;

    const resolved = await resolveErrorOverride(handleError, thrown, event, status, message);
    if (resolved instanceof Response) {
      return applyResolveOptions(resolved, resolveOpts);
    }
    ({ status, message } = resolved);

    // Log after the hook runs so a handleError that short-circuits with a
    // Response or downgrades the status doesn't produce a misleading 500.
    if (status >= 500 && thrown) {
      logger.error(`${req.method} ${event.url.pathname} → ${status}:`, thrown);
    }

    const stack = development && thrown instanceof Error && typeof thrown.stack === 'string' ? thrown.stack : undefined;
    const errorProp: { status: number; message: string; stack?: string } = { status, message };
    if (stack) {
      errorProp.stack = stack;
    }

    let html: string;
    try {
      const result = await registry.renderComponent(errorPagePath, { error: errorProp });
      html = renderShell(result);
    } catch (renderErr) {
      logger.error(`errorPage "${errorPagePath}" failed to render:`, renderErr);
      const body = `[mochi] Error ${status}: ${message}\n\n` + `The error page also failed to render.\n` + `Check the server logs for both errors.`;
      return new Response(body, {
        status,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    const baseResponse = new Response(html, {
      status,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
    return applyResolveOptions(baseResponse, resolveOpts);
  };

  const routeErrorResponse: RouteErrorResponse = (req, event, resolveOpts, err) => {
    const { status, message } = err instanceof MochiHttpError ? { status: err.status, message: err.message } : { status: 500, message: 'Internal Server Error' };
    return renderErrorResponse({ req, event, resolveOpts, status, message, thrown: err });
  };

  return { renderErrorResponse, routeErrorResponse };
}
