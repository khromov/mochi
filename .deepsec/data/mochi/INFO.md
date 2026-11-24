# mochi

## What this codebase does

Mochi is an SSR web framework for Svelte 5 on Bun — published to npm as `mochi-framework` — plus the
sites that run on it. Bun workspaces monorepo:

- `packages/mochi` — the framework. `Mochi.serve()` registers Bun routes from a `routes` map of
  `Mochi.page` / `Mochi.api` / `Mochi.ws` / `Mochi.sse` / `Mochi.file` values, then layers a
  per-request pipeline (`runtime/`), a Svelte compile/bundle pipeline (`compiler/`), server islands
  (`islands/`), an image transform endpoint (`image/`), a proof-of-work browser gate (`protection/`,
  `captcha/`), durable queues and cron (`queue.ts`, `cron.ts`), email (`email/`), and dev-only
  tooling (`dev/`, `debug-bar/`).
- Deployed apps that exercise it: `packages/site` (mochi.fast, 3333), `packages/demos` (3334),
  `packages/minimal` (3335), `packages/support` (support.mochi.fast, 3336).
- `packages/cli` is the `create-mochi` scaffolder; `packages/mochi/src/cli` is the `mochi-framework`
  build CLI.
- Security primitives are first-party rather than library-provided: AES-256-SIV payload sealing,
  Origin-based CSRF, an SSRF guard, a PoW captcha, and HTTP Basic auth in `support`.

## Auth shape

There is no framework-level session or user model — apps bring their own. What exists:

- `packages/support/src/adminAuth.ts` — the only real credential check. HTTP Basic against
  `ADMIN_USER`/`ADMIN_PASSWORD` via `credentialsMatch()` (SHA-256 digest + `timingSafeEqual`),
  mounted as a `sequence()` handle gating every `/admin*` path, with `authFailureDelay()` as a tarpit
  and a per-route `rateLimit.skip` that spends quota only on a genuine wrong guess.
- `packages/site/src/demos/login/session.ts` — a demo HMAC cookie (`createSessionToken` /
  `verifySessionToken`) keyed off `getMochiConfig().secretKey`; the password is the literal `hunter2`.
  Illustrative, not production auth.
- Capability tokens stand in for sessions elsewhere: server-island props and image requests are
  sealed with `encryptPayload`/`decryptPayload` (AES-256-SIV, AAD = component name or filename);
  protection clearance is a sealed cookie checked by `hasValidClearance`; newsletter confirm and
  unsubscribe are unguessable DB tokens read via `subscriberByConfirmToken` /
  `subscriberByUnsubscribeToken`.
- Request-level controls, not identity: `csrfCheck` (Origin vs `resolveExpectedOrigin`),
  `checkRouteLimit`, the `protection` gate, `MochiCookieJar` + `finalizeCookieHeaders`.
- Dev surfaces are gated by flags, never by auth: `debugBarEnabled = development && …`,
  `emailViewerEnabled`, `MOCHI_MEMORY_PROBE`.

## Threat model

- Anything reachable without a token is internet-facing: every `Mochi.page`/`Mochi.api` route, the
  server-island endpoint, the image endpoint, the protection verify POST, the `/mcp` docs tool
  server, and public-dir static files. The support form, the newsletter embed, and the newsletter
  token GETs are among the only unauthenticated paths that write a database or send mail.
- `MOCHI_KEY` is the single secret behind island props, image URLs, captcha tokens, protection
  clearance, and the demo session cookie. A weak or absent key (a boot warning, not an error) or a
  cross-purpose token replay (AAD mix-up) collapses several boundaries at once.
- Proxy trust is explicit and spoofable when misconfigured: `proxy.addressHeader`/`xffDepth` feed
  `getClientAddress()` and therefore rate-limit and ban keys; `proxy.origin`/`hostHeader` feed the
  CSRF expected origin; `requestIdHeader` seeds log correlation.
- The image endpoint fetches partially attacker-influenced URLs; `resolvePublicUrl` + `fetchPinned`
  re-validate every redirect hop and pin to an already-resolved IP.
- SSR renders untrusted HTML: HN comments pass through `sanitizeHtml`/`safeUrl`, and islands
  serialize props into the page via `renderIslandPropsScript` and `escapeHtmlAttr`.
- Dev-only code reaching production matters here: the email viewer streams arbitrary attachment
  bytes, the client-stats page discloses bundle inputs and paths, and live-reload plus `devWatcher`
  watch the filesystem.
- Supply chain: `create-mochi` downloads a GitHub tarball and writes it to disk; `mochi-framework
  update-skill` fetches `https://mochi.fast/SKILL.md` into the project.

## Project-specific patterns to flag

- A new `Mochi.api()` route that mutates state: `KIND_POLICY` in `runtime/requestSetup.ts` runs CSRF
  for `api`, but the check covers only form content types, so a JSON mutation leans on CORS preflight
  alone — and `api` routes get no trailing-slash or debug-bar policy.
- Any `decryptPayload`/`decryptProps` call whose `aad` is missing, constant, or not derived from the
  request — the AAD is what stops a token minted for one component or filename being replayed at
  another.
- Reading `x-forwarded-proto`/`-host`/`-for` or `x-request-id` directly instead of through
  `getClientAddress()` / `resolveExpectedOrigin()`, or an `xffDepth` that counts from the left.
- An internal route added to `bunRoutes` / `internalRoutes` without a `development`,
  `debugBarEnabled`, or `emailViewerEnabled` guard; or a `Mochi.serve()` filter (`csrf:check`,
  `serverIsland:secretKey`, `captcha:minAgeMs`, `publicDir:scan`) that weakens a default.
- HTML assembled by concatenation in SSR or web-component code without `escapeHtmlAttr` or the
  `\u003C` escaping `renderIslandPropsScript` uses; and archive extraction that joins an entry name
  onto an output directory (`packages/cli/src/download.ts`) without rejecting `..` segments.

## Known false-positives

- `csrf.ts` letting JSON and octet-stream bodies through unchecked is deliberate and documented:
  browsers preflight those cross-origin.
- `/newsletter/confirm` and `/newsletter/unsubscribe` acting on GET is intentional (one-click
  List-Unsubscribe); the token is the authorisation and the trade-off is written into the route.
- `packages/site` setting `image.blockPrivateNetworks: false` is intentional — that site's image
  sources are hardcoded and every URL is server-minted.
- `protection/gate.ts` treating a throwing `protect()` as protected, and `isBlockedIp` returning true
  on an unparseable address, are fail-closed by design.
- `mochiConfig.ts` generating a random `MOCHI_KEY` with only a warning is the documented dev
  ergonomic; the deployed apps' `mochi:init` hooks are where required env is enforced.
- `packages/site/src/demos/*` and the HN/admin/todo demos are demonstration code (hardcoded
  `hunter2`, shared mutable module state, no auth) — judge them as documentation, not product.
- `__fixtures__`, `*.test.ts`, `.mochi/`, `cli-tests/`, `snapshots/`, and `packages/mochi/src/vendor/`
  are fixtures, tests, build output, or vendored code.
