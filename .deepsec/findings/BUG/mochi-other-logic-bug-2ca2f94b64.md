# [BUG] Form fixture sends no Origin header, so it would be rejected by production CSRF even after the trailing slash is fixed

**File:** [`packages/mochi/scripts/leak/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/scripts/leak/routes.ts#L13-L19) (lines 13, 16, 19)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The `form:data-loading` fixture (L13-20) POSTs with `Content-Type: application/x-www-form-urlencoded` and no `Origin` header. Once the trailing-slash defect above is fixed and the request actually reaches the CSRF stage, it will 403 rather than run the action.

Trace: `KIND_POLICY.page.csrf` is true (`requestSetup.ts:63`), so `csrfCheck` runs (`requestSetup.ts:120`). `DEFAULT_PROTECTED_METHODS` contains POST and `isFormContentType('application/x-www-form-urlencoded')` is true, so the request is gated (`runtime/csrf.ts:126-131`). `packages/site` configures `proxy: { origin, … }` (index.ts:201), so `expectedOriginConfigured` is true and execution reaches L149-155: `origin = request.headers.get('origin')` is null, so `originNormalized` is null, both pass-branches are skipped, `development` is false (the harness forces `NODE_ENV=production`), and `csrfForbidden` returns a 403. The mismatch is compounded because `origin` resolves to `http://localhost:3333` (CSRF_DOMAIN/CSRF_PORT default when `MOCHI_DOMAIN`/`MOCHI_PORT` are unset) while the harness actually listens on 13333 — so even sending the server's own origin would not match.

As with the other dead routes, a 403 lands in `status4xx` and is counted as a successful request, so the verdict stays PASS.

## Recommendation

Add `Origin` to the fixture's headers matching the harness's own base URL, and have `runLeakTest.ts` pass `MOCHI_DOMAIN`/`MOCHI_PORT` into the spawned env so `proxy.origin` resolves to `http://localhost:<--port>`. Alternatively set `MOCHI_PORT` to the harness port and send `Origin: http://localhost:${port}`. Verify with a pre-workload assertion that the form POST returns a 2xx/3xx action result rather than a 403.

## Revalidation

**Verdict:** true-positive

Verified as a latent defect, correctly scoped by the finding itself to 'even after the trailing slash is fixed'. Today the 308 from F4 fires first, so CSRF is never reached; once the fixture path gains its slash, the trace is: `KIND_POLICY.page.csrf` true (requestSetup.ts:63) → `csrfCheck` at requestSetup.ts:120 → `DEFAULT_PROTECTED_METHODS` contains POST (csrf.ts:26) → `isFormContentType('application/x-www-form-urlencoded')` true (csrf.ts:60-68) → `expectedOriginConfigured` true because index.ts:201 sets `proxy: { origin, … }` → L149-155: `request.headers.get('origin')` is null (routes.ts:19 sets only Content-Type), so `originNormalized` is null and both pass-branches at L153 and L156 are skipped → `development` is false because the harness forces `NODE_ENV=production` → `csrfForbidden` returns 403 at L171. I also confirmed the compounding mismatch: index.ts:115-118 computes `origin` from `MOCHI_PORT`/`MOCHI_DOMAIN`, which the harness never sets, so `resolveExpectedOrigin` (proxy.ts:58-60) returns the literal `http://localhost:3333` while the harness listens on 13333 via `PORT` — so even a self-origin header would mismatch. And the resulting 403 lands in `status4xx` and is counted as a success (loadGen.ts:117-122), so F1 keeps the verdict PASS. The page does declare a `default` action returning `redirect(303, …)` (`packages/site/src/demos/data-loading/routes.ts:7-17`), so there is a real code path being skipped. This is a distinct defect at a distinct location from F4 (missing header on lines 13/16/19 vs slashless path), so it is not a duplicate. BUG is right — it is currently masked and only bites after F4 is fixed.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-18)
