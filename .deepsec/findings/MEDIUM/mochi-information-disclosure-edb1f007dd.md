# [MEDIUM] Svelte compile errors (absolute paths and code frames) are rendered to clients in production

**File:** [`packages/mochi/src/Mochi.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/Mochi.ts#L898-L900) (lines 898, 900)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `information-disclosure`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

L898-901, on the page render path: `const compileErrors = registry.getErrors(); if (compileErrors.length > 0) { throw new MochiHttpError(500, formatCompileErrors(compileErrors)); }`. `routeErrorResponse` (`runtime/errors.ts:120`) then takes the status *and message* verbatim for any `MochiHttpError` — `err instanceof MochiHttpError ? { status: err.status, message: err.message } : { status: 500, message: 'Internal Server Error' }` — with no `development` check. Only `stack` is dev-gated (errors.ts:93). The message is passed to the error page as `error.message` and rendered (escaped, so no XSS) in both the `<title>` and the page body.

So a compile failure discloses `formatCompileErrors()` output — component file paths and Svelte diagnostics — to any anonymous visitor in production. Reachable paths: (a) production without a prebuilt manifest, which compiles at boot and on the request path (L607 logs this as unsupported but still serves), and (b) production *with* a manifest where an island is missing from it and is compiled on demand at `/_mochi/island/...` (L1612), after which the next page render surfaces the queued errors. Everywhere else in the framework the production/development split is respected (`handleEnhancedError` L743, `emitError` L527, errors.ts:93), which is what makes this one an oversight rather than a policy.

## Recommendation

Keep the detailed compile text for the log and serve a generic message in production: throw `new MochiHttpError(500, development ? formatCompileErrors(compileErrors) : 'Internal Server Error')` (logging the full text with `logger.error` either way), or carry the detail in a non-rendered field so only `development` error pages print it.

## Revalidation

**Verdict:** true-positive

The chain is real. Mochi.ts:898-901 throws `new MochiHttpError(500, formatCompileErrors(compileErrors))` on the page render path with no mode check, and runtime/errors.ts:120 takes a MochiHttpError's status *and message* verbatim (`err instanceof MochiHttpError ? { status: err.status, message: err.message } : { status: 500, message: 'Internal Server Error' }`); only `stack` is dev-gated (errors.ts:93). templates/DefaultError.svelte renders `{error.message}` in both `<title>` and the body, so the text reaches any anonymous visitor in production (escaped, so no XSS — as the finding says). This is a genuine break in the framework's otherwise consistent dev/prod discipline (compare handleEnhancedError at 743, emitError at 527). Two accuracy notes. First, the disclosed content is narrower than 'absolute paths and code frames' for most error kinds: `formatCompileError` runs every file path through `relForDisplay()` (ComponentRegistry.ts:276, 281, 287), so those are project-relative. The exception is `css-bundle-failed`, whose `cssPath` is the resolved entry path and whose `message` is `formatBuildMessages(cssResult.logs)` (line 2205) — raw Bun bundler output, which does carry absolute paths and code frames. Second, reachability requires a broken deploy: either production without a prebuilt manifest (Mochi.ts:607 logs this as unsupported but keeps serving) or a manifest miss compiled on demand at the island endpoint (1612 → compileAll's `loadedFromManifest && !development` warn path at 735, which can still push to `this.errors`). Keeping MEDIUM: conditional, low-sensitivity disclosure (project structure and build diagnostics), but a real missing production guard.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-11-14)
