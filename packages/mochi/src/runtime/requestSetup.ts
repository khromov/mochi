import type { Server } from 'bun';
import { csrfCheck, type MochiCsrfOptions } from './csrf';
import { buildPublicUrl, getClientAddress, type MochiProxyOptions } from './proxy';
import { extractParams } from '../utils';
import { applyFilter } from '../extensions';
import { trailingSlashRedirect, type TrailingSlashPolicy } from './trailingSlash';
import { MochiCookieJar, type CookieSerializeOptions } from './cookies';
import { mochiEvents } from '../events';
import { isWarmupRequest } from './warmup';
import type { MochiRequestContext } from './requestContext';

// RouteKind covers user-route shapes; MochiRequestKind in events.ts covers the
// broader event taxonomy (asset, fallback, error). They overlap on page|api|file.
export type RouteKind = 'page' | 'api' | 'ws' | 'sse' | 'island' | 'file';

export interface RequestSetupConfig {
  proxy: MochiProxyOptions | undefined;
  csrf: MochiCsrfOptions | undefined;
  trailingSlashPolicy: TrailingSlashPolicy | undefined;
  cookieDefaults: CookieSerializeOptions;
  development: boolean;
  debugBarEnabled: boolean;
  formContentTypes: ReadonlySet<string>;
  protectedMethods: ReadonlySet<string>;
  trustedOrigins: ReadonlySet<string>;
  newRequestId: (req: Request) => string;
}

export interface PerCallOptions {
  kind: RouteKind;
  pattern: string;
  paramsOverride?: Record<string, string>;
  csrfErrorTransform?: (resp: Response) => Response;
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

export type RequestContextBuilder = (req: Request, server: Server<undefined>, opts: PerCallOptions) => SetupResult;

interface KindPolicy {
  timeout: boolean;
  trailingSlash: boolean;
  mirrorSlash: boolean;
  csrf: boolean;
  debugBar: boolean;
}

// `trailingSlash` is whether a matched request redirects to the canonical form; `mirrorSlash` is whether the route is
// also registered under its other slash form. Kinds with `mirrorSlash` but no `trailingSlash` serve both forms as-is.
const KIND_POLICY: Record<RouteKind, KindPolicy> = {
  page: { timeout: true, trailingSlash: true, mirrorSlash: true, csrf: true, debugBar: true },
  // Api routes never mirror or redirect on trailing slash — only the exact
  // declared pattern matches, regardless of the global policy.
  api: { timeout: false, trailingSlash: false, mirrorSlash: false, csrf: true, debugBar: false },
  sse: { timeout: true, trailingSlash: true, mirrorSlash: true, csrf: false, debugBar: false },
  ws: { timeout: false, trailingSlash: false, mirrorSlash: true, csrf: false, debugBar: false },
  island: { timeout: false, trailingSlash: false, mirrorSlash: false, csrf: false, debugBar: false },
  // Files are leaf resources (like static assets), so a matched file URL is never
  // redirected to gain a trailing `/` — though both forms still resolve to it.
  file: { timeout: false, trailingSlash: false, mirrorSlash: true, csrf: false, debugBar: false },
};

// The single source of truth for alt-slash registration, shared by the initial
// registration in `Mochi.ts` and by dev hot-reload in `devWatcher.ts`.
export function mirrorsSlashForm(kind: RouteKind): boolean {
  return KIND_POLICY[kind].mirrorSlash;
}

export function makeRequestContextBuilder(cfg: RequestSetupConfig): RequestContextBuilder {
  return function buildRequestContext(req, server, opts): SetupResult {
    const policy = KIND_POLICY[opts.kind];
    const start = performance.now();
    const requestId = cfg.newRequestId(req);
    if (policy.timeout) {
      server.timeout(req, 0);
    }
    const params = extractParams(req);
    const url = buildPublicUrl(req, cfg.proxy);

    const reportEarlyExit = (status: number): void => {
      // 'request' event accepts only page|api|file kinds; see MochiRequestKind in events.ts
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
