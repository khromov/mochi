import type { Server } from 'bun';
import { csrfCheck, type MochiCsrfOptions } from './csrf';
import { buildPublicUrl, getClientAddress, type MochiProxyOptions } from './proxy';
import { extractParams } from '../utils';
import { applyFilter } from '../extensions';
import { trailingSlashRedirect, type TrailingSlashPolicy } from './trailingSlash';
import { MochiCookieJar, type CookieSerializeOptions } from './cookies';
import { generateCspNonce } from './security';
import { mochiEvents } from '../events';
import { isWarmupRequest } from './warmup';
import type { MochiRequestContext } from './requestContext';
import type { ProtectionGate } from '../protection/gate';

// RouteKind covers user-route shapes; MochiRequestKind in events.ts covers the
// broader event taxonomy (asset, fallback, error). They overlap on page|api|file.
export type RouteKind = 'page' | 'api' | 'ws' | 'sse' | 'island' | 'file';

export interface RequestSetupConfig {
  proxy: MochiProxyOptions | undefined;
  csrf: MochiCsrfOptions | undefined;
  trailingSlashPolicy: TrailingSlashPolicy | undefined;
  cookieDefaults: CookieSerializeOptions;
  csp: boolean;
  development: boolean;
  debugBarEnabled: boolean;
  formContentTypes: ReadonlySet<string>;
  protectedMethods: ReadonlySet<string>;
  trustedOrigins: ReadonlySet<string>;
  newRequestId: (req: Request) => string;
  protection?: ProtectionGate;
}

export interface PerCallOptions {
  kind: RouteKind;
  pattern: string;
  paramsOverride?: Record<string, string>;
  csrfErrorTransform?: (resp: Response) => Response;
  /** The protection verify endpoint sets this — the one route that must answer an uncleared client. */
  skipProtection?: boolean;
}

export type SetupResult =
  | { earlyResponse: Response }
  | {
      ctx: MochiRequestContext;
      start: number;
      requestId: string;
      url: URL;
      params: Record<string, string>;
    };

export type RequestContextBuilder = (req: Request, server: Server<undefined>, opts: PerCallOptions) => Promise<SetupResult>;

interface KindPolicy {
  timeout: boolean;
  trailingSlash: boolean;
  csrf: boolean;
  debugBar: boolean;
}

// `trailingSlash` governs both halves of the policy — registering the route under its other slash form, and redirecting
// a matched request to the canonical one. Only pages get it: a canonical URL is a navigation concern, and every other
// kind is addressed by a client that already knows the exact pattern it wants.
const KIND_POLICY: Record<RouteKind, KindPolicy> = {
  page: { timeout: true, trailingSlash: true, csrf: true, debugBar: true },
  api: { timeout: false, trailingSlash: false, csrf: true, debugBar: false },
  sse: { timeout: true, trailingSlash: false, csrf: false, debugBar: false },
  ws: { timeout: false, trailingSlash: false, csrf: false, debugBar: false },
  island: { timeout: false, trailingSlash: false, csrf: false, debugBar: false },
  file: { timeout: false, trailingSlash: false, csrf: false, debugBar: false },
};

/** The kinds that reach the alt-slash mirroring decision, i.e. everything `registerRoutePattern` can return. */
export type MirrorableRouteKind = Exclude<RouteKind, 'island'>;

// The single source of truth for alt-slash registration, shared by the initial
// registration in `Mochi.ts` and by dev hot-reload in `devWatcher.ts`.
export function mirrorsSlashForm(kind: MirrorableRouteKind): boolean {
  return KIND_POLICY[kind].trailingSlash;
}

export function makeRequestContextBuilder(cfg: RequestSetupConfig): RequestContextBuilder {
  return async function buildRequestContext(req, server, opts): Promise<SetupResult> {
    const policy = KIND_POLICY[opts.kind];
    const start = performance.now();
    const requestId = cfg.newRequestId(req);
    if (policy.timeout) {
      server.timeout(req, 0);
    }
    const params = extractParams(req);
    const url = buildPublicUrl(req, cfg.proxy);

    const reportEarlyExit = (status: number): void => {
      // A compile-time narrow, not a runtime filter: `MochiRequestKind` in events.ts excludes ws/sse/island, and since
      // only page and api can early-exit at all (trailingSlash, csrf) nothing reaches this with an unemittable kind.
      if (opts.kind !== 'page' && opts.kind !== 'api' && opts.kind !== 'file') {
        return;
      }
      mochiEvents.emit('request', {
        requestId,
        kind: opts.kind,
        method: req.method,
        path: url.pathname + url.search,
        status,
        duration: performance.now() - start,
      });
    };

    if (policy.trailingSlash && cfg.trailingSlashPolicy) {
      const redirect = applyFilter('trailingSlash:redirect', trailingSlashRedirect(req.method, url, cfg.trailingSlashPolicy), {
        request: req,
        url,
        policy: cfg.trailingSlashPolicy,
      });
      if (redirect) {
        reportEarlyExit(redirect.status);
        return { earlyResponse: redirect };
      }
    }

    if (policy.csrf) {
      const csrfResponse = csrfCheck(req, url, cfg.csrf, cfg.proxy, cfg.development, cfg.formContentTypes, cfg.protectedMethods, cfg.trustedOrigins);
      if (csrfResponse) {
        const finalResp = opts.csrfErrorTransform ? opts.csrfErrorTransform(csrfResponse) : csrfResponse;
        reportEarlyExit(finalResp.status);
        return { earlyResponse: finalResp };
      }
    }

    const cookies = new MochiCookieJar(req.headers.get('Cookie'), cfg.cookieDefaults);

    if (cfg.protection && !opts.skipProtection) {
      const blocked = await cfg.protection({ request: req, url, kind: opts.kind, cookies, server });
      if (blocked) {
        reportEarlyExit(blocked.status);
        return { earlyResponse: blocked };
      }
    }

    const ctx: MochiRequestContext = {
      requestId,
      request: req,
      url,
      params: opts.paramsOverride ?? params,
      locals: {},
      isWarmup: isWarmupRequest(req),
      cookies,
      islandProps: new Map(),
      getClientAddress: () => getClientAddress(req, server.requestIP(req)?.address ?? null, cfg.proxy),
    };

    if (cfg.csp) {
      ctx.cspNonce = generateCspNonce();
    }

    if (policy.debugBar && cfg.debugBarEnabled) {
      ctx.debugBarData = {
        route: opts.pattern,
        pathname: url.pathname,
        params,
        pageCacheEnabled: true,
        varyOnCookies: [],
        images: [],
        serverProps: {},
      };
    }

    return { ctx, start, requestId, url, params };
  };
}
