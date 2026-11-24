# [MEDIUM] Enhanced form submissions navigate via `window.location.assign()` with no scheme validation, upgrading an open redirect into same-origin XSS

**File:** [`packages/mochi/src/runtime/enhance.client.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/runtime/enhance.client.ts#L60-L62) (lines 60, 61, 62)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `unsafe-redirect`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The default fallback for a `redirect` envelope calls `window.location.assign(result.location)` (L62) with the server-supplied string unchecked. `result.location` is `redirect(status, location)`'s argument passed straight through: forms.ts:21-23 stores it verbatim, Mochi.ts:1135 hands it to `jsonRedirect`, and formsJson.ts:56 serializes it with no validation at any hop. The security-relevant part is the behavioural divergence between the two submit paths for the same action code. On the native (no-JS) path Mochi sets it as a `Location` header (Mochi.ts:1137-1140), and a non-HTTP(S) scheme there is inert — per Fetch's HTTP-redirect fetch, a `Location` whose scheme is not HTTP(S) is a network error, so `Location: javascript:alert(1)` never executes. On the enhanced path the same value reaches `location.assign`, a standard DOM-XSS sink that does execute a `javascript:` URL in the current document's origin. So the common login-flow pattern `redirect(303, formData.get('next') ?? '/')` — which on the native path is 'only' an open redirect, and is fully inert for `javascript:` — becomes script execution in the app's own origin as soon as the form carries `{@attach enhance()}`. packages/docs/74-use-enhance.md:55 documents `window.location.assign(result.location)` as the contract with no caveat about validating the target, so app authors have no cue that the client path is strictly more dangerous than the server one.

## Recommendation

Validate the target before navigating: parse it with `new URL(result.location, window.location.href)` and refuse anything whose `protocol` is not `http:`/`https:` (logging via `logger.error` instead), which blocks `javascript:`, `data:` and `blob:` while leaving relative and absolute HTTP(S) redirects working. Consider also rejecting cross-origin targets by default (as SvelteKit's `goto` does) behind an opt-in, and validating the scheme server-side in `forms.ts`'s `redirect()` so both paths agree.

## Revalidation

**Verdict:** true-positive

The sink and the absence of validation are verified at every hop. `redirect(status, location)` stores the argument verbatim (forms.ts:21-23), the action path hands it to `jsonRedirect` for enhanced submissions (Mochi.ts:1132-1136), `jsonRedirect` serialises it unchecked (formsJson.ts:56-58), `deserialize` only devalue-decodes `data` (enhance.client.ts:9-15), and the default fallback passes it straight to `window.location.assign(result.location)` (L60-62) with no scheme test — `location.assign` is a standard DOM-XSS sink and a `javascript:` URL navigation initiated by same-origin script evaluates in the current document (blocked only by a CSP without `unsafe-inline`, and the framework sets no default CSP). The asymmetry the finding rests on is also correct: on the native path the same value becomes a `Location` header (Mochi.ts:1137-1140), and per Fetch's HTTP-redirect-fetch a non-HTTP(S) `Location` scheme is a network error, so `javascript:` is inert there. 74-use-enhance.md:49-56 documents `window.location.assign(result.location)` as the contract with no caveat about validating the target, which is what leaves app authors unaware that adding `{@attach enhance()}` upgrades an open redirect into same-origin script execution. The honest caveat is that reaching it requires app code that forwards untrusted input into `redirect()` — I grepped every `redirect(` call site in this monorepo and all of them use literals or safely-encoded internal paths (the closest is `demos/data-loading/routes.ts:15`, which `encodeURIComponent`s into a path), so nothing here is exploitable today. It remains a real framework-level hardening defect: the fix (reject anything whose `protocol` isn't `http:`/`https:` after `new URL(location, window.location.href)`, and validate server-side in `redirect()` so both paths agree) matches what SvelteKit's `goto`-based `applyAction` already enforces. MEDIUM, contingent on app misuse.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-13)
