import type { Server } from 'bun';
import type { ComponentRegistry, RenderResult } from '../compiler/ComponentRegistry';
import { mintCaptcha } from '../captcha/captcha';
import { requestContext, type MochiRequestContext } from '../runtime/requestContext';
import { finalizeCookieHeaders, type MochiCookieJar } from '../runtime/cookies';
import { getClientAddress, type MochiProxyOptions } from '../runtime/proxy';
import { isWarmupRequest } from '../runtime/warmup';
import type { TrailingSlashPolicy } from '../runtime/trailingSlash';
import { logger } from '../utils/log';
import { hasValidClearance } from './clearance';
import { PROTECTION_SHELL_COMPONENT } from './config';
import type { MochiProtectionContext, MochiProtectionKind, ResolvedProtectionOptions } from './types';

export interface ProtectionGateInput {
  request: Request;
  url: URL;
  kind: MochiProtectionKind;
  cookies: MochiCookieJar;
  server: Server<undefined>;
}

/** Returns the blocked response, or undefined to let the request through. */
export type ProtectionGate = (input: ProtectionGateInput) => Promise<Response | undefined>;

export interface ProtectionRuntime {
  gate: ProtectionGate;
  /** Slashless base path; the verify route registers both slash variants off it. */
  verifyPath: string;
  /** The variant canonical under the app's trailingSlash policy — what the widget POSTs to, skipping the 308 hop. */
  verifyUrl: string;
  options: ResolvedProtectionOptions;
}

const BLOCKED_MESSAGE = 'Browser verification required';

export function createProtectionRuntime(deps: {
  options: ResolvedProtectionOptions;
  registry: ComponentRegistry;
  renderShell: (result: RenderResult) => string;
  assetPrefix: string;
  newRequestId: (req: Request) => string;
  proxy: MochiProxyOptions | undefined;
  trailingSlashPolicy: TrailingSlashPolicy | undefined;
}): ProtectionRuntime {
  const { options, registry, renderShell, newRequestId, proxy } = deps;
  const pagePath = options.page ?? PROTECTION_SHELL_COMPONENT;
  const verifyPath = `${deps.assetPrefix}/protection/verify`;
  const verifyUrl = deps.trailingSlashPolicy === 'always' ? `${verifyPath}/` : verifyPath;

  // Logged once, not per request: a protect() that throws does so on every hit.
  let protectThrewLogged = false;
  const isProtected = (ctx: MochiProtectionContext): boolean => {
    if (!options.protect) {
      return true;
    }
    try {
      return options.protect(ctx);
    } catch (err) {
      if (!protectThrewLogged) {
        protectThrewLogged = true;
        logger.error('protection.protect threw — failing closed (every request treated as protected):', err);
      }
      return true;
    }
  };

  let messageThrewLogged = false;
  const blockedMessageFor = (ctx: MochiProtectionContext): string => {
    if (typeof options.blockedMessage === 'string') {
      return options.blockedMessage;
    }
    if (typeof options.blockedMessage === 'function') {
      try {
        return options.blockedMessage(ctx);
      } catch (err) {
        if (!messageThrewLogged) {
          messageThrewLogged = true;
          logger.error('protection.blockedMessage threw — falling back to the default message:', err);
        }
      }
    }
    return BLOCKED_MESSAGE;
  };

  const interstitialResponse = async (input: ProtectionGateInput): Promise<Response> => {
    const minted = mintCaptcha({ bits: options.bits });
    // A minimal ambient context, like the error responder's: the interstitial renders outside any
    // route handler, and its hydratable island needs `ctx.islandProps` to exist.
    const ctx: MochiRequestContext = {
      requestId: newRequestId(input.request),
      request: input.request,
      url: input.url,
      params: {},
      locals: {},
      isWarmup: false,
      cookies: input.cookies,
      islandProps: new Map(),
      getClientAddress: () => getClientAddress(input.request, input.server.requestIP(input.request)?.address ?? null, proxy),
    };
    let html: string;
    try {
      const result = await requestContext.run(ctx, () =>
        registry.renderComponent(pagePath, {
          token: minted.token,
          bits: minted.bits,
          solveBudgetMs: minted.solveBudgetMs,
          verifyUrl,
          maxAttempts: options.maxAttempts,
        }),
      );
      html = renderShell(result);
    } catch (renderErr) {
      logger.error('protection interstitial failed to render:', renderErr);
      return new Response(`[mochi] 403: ${BLOCKED_MESSAGE}\n\nThe verification page also failed to render.\nCheck the server logs.`, {
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return new Response(html, {
      status: 403,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  };

  const blockedResponse = (input: ProtectionGateInput, ctx: MochiProtectionContext): Promise<Response> | Response => {
    // Only navigations get the interstitial: solving it ends in a reload, and reloading a POST result
    // re-submits the form (or loses it behind a resubmission prompt) — a JSON 403 fails cleanly instead.
    const method = input.request.method;
    if ((input.kind === 'page' || input.kind === 'fallback') && (method === 'GET' || method === 'HEAD')) {
      return interstitialResponse(input);
    }
    if (input.kind === 'api' || input.kind === 'page' || input.kind === 'fallback') {
      return Response.json({ error: blockedMessageFor(ctx) }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }
    return new Response(blockedMessageFor(ctx), { status: 403, headers: { 'Cache-Control': 'no-store' } });
  };

  const gate: ProtectionGate = async (input) => {
    if (isWarmupRequest(input.request)) {
      return undefined;
    }
    const path = input.url.pathname;
    if (path === verifyPath || path === `${verifyPath}/`) {
      return undefined;
    }
    const ctx: MochiProtectionContext = { kind: input.kind, path, url: input.url, request: input.request };
    if (!isProtected(ctx)) {
      return undefined;
    }
    // Reading through the jar marks it accessed, so finalizeCookieHeaders varies
    // this and every cleared response on Cookie — shared caches stay honest.
    if (hasValidClearance(input.cookies.get(options.cookieName), options.maxAgeMs, options.bits)) {
      return undefined;
    }
    return finalizeCookieHeaders(await blockedResponse(input, ctx), input.cookies);
  };

  return { gate, verifyPath, verifyUrl, options };
}
