# [BUG] Unauthenticated email-send actions have no rate limit and flush a shared global outbox

**File:** [`packages/site/src/demos/email/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/email/routes.ts#L6-L26) (lines 6, 10, 25, 26)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `rate-limit-bypass`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

Both page actions (`?/send`, `?/sendPhoto`) are reachable by any unauthenticated visitor on the deployed site and are not rate limited. `packages/site/src/index.ts` passes no `rateLimit` to `Mochi.serve()`, and this `Mochi.page()` declares no per-route `rateLimit`, so `buildLimiter()` (packages/mochi/src/Mochi.ts:801-816) returns `null` and `checkRouteLimit(routeLimiters.get(pattern) ?? null, ...)` in the shared `wrapRequest` path (Mochi.ts:981) never gates the POST.

Per-request server work: `Mochi.email()` → `renderEmailComponent()` runs a Svelte SSR render, concatenates the scoped CSS, and executes a `@css-inline/css-inline-wasm` inlining pass plus an `HTMLRewriter` html→text pass (packages/mochi/src/email/render.ts, mailer.ts:93). `sendPhoto` additionally re-reads the 32 KB JPEG from disk on every single request (`await Bun.file(ATTACHMENT.path).bytes()`, L26) and the resulting bytes are retained in the outbox entry (`recordDevEmail` stores `content`, devOutbox.ts:70).

Shared-state effect: the capture target is the process-global dev outbox (`__mochi_email_runtime__.outbox`), capped at `MAX_OUTBOX = 100` and shared by every visitor. ~100 scripted POSTs therefore evict every message other visitors captured, breaking the demo's own advertised payoff (Email.svelte:14-16 and EmailForm.svelte:51 tell visitors to open `/_mochi/email` to read their captured message). The deployed site image runs in dev mode (`Dockerfile`, NODE_ENV=development), so `emailTransportType === 'dev'` and this outbox path is the live production behaviour.

Mitigations that cap this at MEDIUM and keep it out of mail-abuse territory: the recipient, subject, body and attachment are fixed server-side so no mail can be aimed at a victim inbox; the site's transport is `dev` (or `log` in a prod-mode deployment) so nothing is ever delivered; and the outbox is bounded, so there is no unbounded memory growth. The residual impact is CPU/disk amplification on an unauthenticated endpoint plus denial of the shared outbox for other visitors. Note the site already applies this control to comparable endpoints — `/api/captcha-demo/mint` at 60/m and the OG image route at 120/m (packages/site/src/routes.ts:261, og/routes.ts:46).

## Recommendation

Pass a per-route limit to the page config, which `wrapRequest` applies to the POST action path as well: `Mochi.page('./src/demos/email/Email.svelte', { rateLimit: { limit: 10, window: '1m' }, actions: { ... } })`. Optionally hoist the attachment read out of the handler (read once at module scope, or reuse a cached `Uint8Array`) so a flood cannot drive repeated disk reads.

## Revalidation

**Verdict:** true-positive

The missing control is real and verified end-to-end. The page declares no `rateLimit` and packages/site/src/index.ts passes none to `Mochi.serve()`, so `buildLimiter(undefined, pattern)` returns null (Mochi.ts:801-828) and `checkRouteLimit` (Mochi.ts:981) is a no-op; I confirmed `wrapRequest` wraps the POST action handler too (Mochi.ts:1026-1027), so a page-level `rateLimit` with `skip: (req) => req.method !== 'POST'` would in fact gate these actions — exactly the idiom already applied to `/demos/queue` and `/demos/reload-form-data` (both `limit: 60, window: '1m'`) by commit 1289d8f8, plus 60/m on captcha mint and 120/m on `/og`. So this is a clean, inconsistent gap in a control the maintainers demonstrably treat as required. The per-request work is as described: `sendEmail` → `renderEmailComponent` does a `renderStatic` SSR render, joins scoped CSS, runs `@css-inline/css-inline-wasm` `inline()`, then an `HTMLRewriter` pass and `htmlToText` (email/render.ts, mailer.ts:89-95); `sendPhoto` re-reads the JPEG from disk every request (routes.ts:26) and the bytes are retained in the outbox entry (devOutbox.ts:70-74). I also confirmed the deployed site really is in dev mode — Dockerfile's ENTRYPOINT is `bun run dev:${WORKSPACE}` and packages/site's `dev` script sets `NODE_ENV=development` — so the transport is `dev` (email/config.ts:12), the capture target is the shared process-global outbox capped at `MAX_OUTBOX = 100`, and CSRF only warns in development, making the POST reachable with no Origin at all. I am downgrading from MEDIUM because the amplification is modest rather than asymmetric: every ordinary page on this site is an unlimited unauthenticated SSR render, so the marginal cost here is roughly a CSS-inline pass and a page-cached 32 KB read; no mail is ever delivered (recipient, subject, body and attachment are all fixed server-side and the transport never sends); and the one distinctive effect, evicting other visitors' captures from the bounded dev outbox, degrades only a dev-only viewer. Real defect, correct fix, non-security-grade impact.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-31)
