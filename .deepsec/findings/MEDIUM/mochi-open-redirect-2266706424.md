# [MEDIUM] /hn redirect built from client-controlled req.url instead of the configured proxy.origin

**File:** [`packages/demos/src/hn/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/demos/src/hn/routes.ts#L5) (lines 5)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `open-redirect`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`'/hn': (req) => Response.redirect(new URL('/hn/front', req.url))` derives the absolute redirect target from `req.url`. Under `Bun.serve()` the authority of `req.url` is taken from the request's `Host` header (falling back to the bound address), and its scheme reflects whether the *Bun server itself* has TLS — not the public origin.

Two distinct impacts:

1. **Host-header reflection into `Location`.** A request with `Host: evil.tld` yields `Location: http://evil.tld/hn/front`. The victim's own browser sends the real Host, so this is not directly phishable, but it is the classic Host-injection primitive: any shared cache or intermediary that does not include Host in its cache key, and any tooling that follows `Location`, can be pointed off-origin. (A bare 302 is not cacheable by default per RFC 7231, which limits but does not eliminate this.)

2. **HTTPS -> HTTP downgrade for every real visitor.** `packages/demos/src/index.ts` calls `Mochi.serve()` with no `tls` option, and `Dockerfile.production` ships a plain-HTTP container, so TLS is terminated upstream and `req.url` is always `http://...`. Every visitor hitting `https://demos.mochi.fast/hn` therefore receives `Location: http://demos.mochi.fast/hn/front`. The app sets no `Strict-Transport-Security` header (grep for `strict-transport`/`hsts` across `packages/demos/src` returns nothing), so without a platform-level HSTS policy the follow-up request is sent in cleartext.

The framework already solves this: `runtime/proxy.ts`'s `buildPublicUrl()`/`resolveExpectedOrigin()` pin the origin, and this very app configures `proxy: { origin: process.env.MOCHI_ORIGIN || ... }` (index.ts:27) precisely so the origin is not inferred from the request. `packages/site/src/index.ts:56` uses the correct origin-pinned `event.url` for an identical redirect; this route and `packages/site/src/demos/data-loading/routes.ts:5` use raw `req.url` instead.

## Recommendation

Don't derive the origin from the request. Either return a relative Location (`new Response(null, { status: 308, headers: { Location: '/hn/front/' } })`), or convert the entry to a `Mochi.page`/`Mochi.api` route and build the URL from the pipeline's origin-pinned `getRequestContext().url` / `event.url` as `packages/site/src/index.ts:56` does.

## Revalidation

**Verdict:** true-positive

Mechanism verified. `new URL('/hn/front', req.url)` takes its authority and scheme from the raw Bun request, and the framework exists specifically to avoid that: runtime/proxy.ts documents `buildPublicUrl()` as the thing 'every per-request handler in Mochi.ts uses… so event.url, internal redirects, and the CSRF check all see the public origin under a TLS-terminating reverse proxy', and `proxy.origin` as what 'drives event.url.origin, internal redirects such as trailing-slash canonicalisation'. Being a raw Bun route value (see F4), this route gets none of it, even though demos/src/index.ts:27 configures `proxy.origin` precisely for this. The downgrade half is the solid half, and it sits on the documented entry path — worse than the finding claims: packages/docs/200-demos.md:12 links readers to `https://demos.mochi.fast/hn`, and packages/demos/src/Landing.svelte:23 links `/hn/` (raw route values are mirrored onto both slash forms at Mochi.ts:1546-1551). build.yml:49-57 deploys demos via CapRover on the plain-HTTP root Dockerfile with no `tls` in `Mochi.serve()`, so `req.url` is always `http://…` and every HTTPS visitor to that link receives `Location: http://demos.mochi.fast/hn/front`; my greps of packages/demos, packages/site/src, packages/mochi/src and packages/minimal for `strict-transport`/`hsts` returned nothing, so no in-repo HSTS blunts it. Two bounds on severity: the Host-reflection half is largely blocked in the deployed topology, since CapRover's nginx selects the app by `server_name`, so `Host: evil.tld` never reaches this container (it stays valid for direct container access or non-vhost-routed deployments); and nothing in packages/demos/src sets a cookie (grep for `cookies.set`/`Set-Cookie` is empty), so the cleartext hop carries no credentials. The 'open-redirect' slug is a misnomer — the path is fixed and the Host is echoed to the host the client asked for — but the underlying defect (origin derived from the request rather than `proxy.origin`) is exactly as described, and packages/site/src/index.ts:56 using `event.url` for the same pattern is the right in-repo contrast. Residual real risk: an sslstrip-able plaintext round trip on the demo's main entry point.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-18)
