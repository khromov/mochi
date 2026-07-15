import type { ComponentRegistry, RenderResult } from '../compiler/ComponentRegistry';
import type { HandleError, MochiErrorInfo, MochiEvent, MochiResolveOptions } from './hooks';
import { applyResolveOptions } from './hooks';
import { logger } from '../utils/log';
import { MochiHttpError } from '../utils';

export const DEFAULT_ERROR_PAGE_PATH = Bun.fileURLToPath(new URL('../templates/DefaultError.svelte', import.meta.url));

export interface ErrorResponderDeps {
  handleError: HandleError | undefined;
  development: boolean;
  registry: ComponentRegistry;
  errorPagePath: string;
  renderShell: (result: RenderResult) => string;
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

export function createErrorResponder(deps: ErrorResponderDeps): {
  renderErrorResponse: RenderErrorResponse;
  routeErrorResponse: RouteErrorResponse;
} {
  const { handleError, development, registry, errorPagePath, renderShell } = deps;

  const renderErrorResponse: RenderErrorResponse = async (input) => {
    const { req, event, resolveOpts, thrown } = input;
    let { status, message } = input;

    if (handleError) {
      let override: Response | MochiErrorInfo | void;
      try {
        override = await handleError({ error: thrown, event, status, message });
      } catch (hookErr) {
        logger.error('handleError hook threw:', hookErr);
        override = undefined;
      }
      if (override instanceof Response) {
        return applyResolveOptions(override, resolveOpts);
      }
      if (override && typeof override === 'object') {
        if (typeof override.status === 'number' && typeof override.message === 'string') {
          status = override.status;
          message = override.message;
        } else {
          logger.error('handleError returned invalid override; expected { status: number, message: string } or a Response, got:', override);
        }
      }
    }

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
