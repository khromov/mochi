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
import { PROTECTION_CLEARANCE_COOKIE } from './config';
import type { MochiProtectionContext, MochiProtectionKind, ResolvedProtectionOptions } from './types';

export const PROTECTION_INTERSTITIAL_COMPONENT = Bun.fileURLToPath(new URL('../templates/ProtectionInterstitial/ProtectionInterstitial.svelte', import.meta.url));

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
  renderInterstitialShell: (result: RenderResult) => string;
  assetPrefix: string;
  newRequestId: (req: Request) => string;
  proxy: MochiProxyOptions | undefined;
  trailingSlashPolicy: TrailingSlashPolicy | undefined;
}): ProtectionRuntime {
  const { options, registry, renderInterstitialShell, newRequestId, proxy } = deps;
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
        registry.renderComponent(PROTECTION_INTERSTITIAL_COMPONENT, {
          token: minted.token,
          bits: minted.bits,
          solveBudgetMs: minted.solveBudgetMs,
          verifyUrl,
        }),
      );
      html = renderInterstitialShell(result);
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

  const blockedResponse = (input: ProtectionGateInput): Promise<Response> | Response => {
    if (input.kind === 'page' || input.kind === 'fallback') {
      return interstitialResponse(input);
    }
    if (input.kind === 'api') {
      return Response.json({ error: BLOCKED_MESSAGE }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }
    return new Response(BLOCKED_MESSAGE, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  };

  const gate: ProtectionGate = async (input) => {
    if (isWarmupRequest(input.request)) {
      return undefined;
    }
    const path = input.url.pathname;
    if (path === verifyPath || path === `${verifyPath}/`) {
      return undefined;
    }
    if (!isProtected({ kind: input.kind, path, url: input.url, request: input.request })) {
      return undefined;
    }
    // Reading through the jar marks it accessed, so finalizeCookieHeaders varies
    // this and every cleared response on Cookie — shared caches stay honest.
    if (hasValidClearance(input.cookies.get(PROTECTION_CLEARANCE_COOKIE), options.maxAgeMs)) {
      return undefined;
    }
    return finalizeCookieHeaders(await blockedResponse(input), input.cookies);
  };

  return { gate, verifyPath, verifyUrl, options };
}
