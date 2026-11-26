# [MEDIUM] Server stack traces are rendered to clients on 5xx because the deployed site runs in development mode

**File:** [`packages/site/src/index.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/index.ts#L18-L163) (lines 18, 47, 163)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-info-disclosure`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

Same root cause as the CSRF finding: `Mochi.serve()` does not pass `development`, so it resolves to true in the deployed container. `runtime/errors.ts:93` reads `const stack = development && thrown instanceof Error && typeof thrown.stack === 'string' ? thrown.stack : undefined`, and `templates/DefaultError.svelte` renders `{#if error.stack}<pre class="stack">{error.stack}</pre>{/if}`. Any unhandled server exception on mochi.fast therefore returns a page containing the full stack trace — absolute server filesystem paths, the framework's internal call chain, workspace layout, and whatever values the throwing frame embedded in its message. Triggering a 500 does not require special access: `handleError` (line 47) is reached by, for example, the `/docs/changelog` 503 path when GitHub is unreachable, and by any thrown error in a `serverProps` resolver. This is distinct from the debug toolbar and compile-error overlay the deployment intends to expose; `lib/debugBarEncode.ts` shows the team re-encoding the debug bar's inlined paths precisely to stop path strings leaking, and the error page defeats that effort through a different channel.

## Recommendation

Pass `development: false` in the deployed container (see the CSRF finding), or set a dedicated `errorPage` for the site that never renders `error.stack`. Framework-side, gate the stack on an opt-in option rather than on `development` alone, so 'dev mode for the toolbar' doesn't imply 'stack traces to the public'.

## Revalidation

**Verdict:** true-positive

Mechanism fully confirmed, and the finding actually understates how easily it triggers. `Mochi.serve()` in packages/site/src/index.ts:163 never passes `development`, so Mochi.ts:479 resolves `const development = options.development ?? SEEDED_IS_DEV`, and utils/env.ts defines `SEEDED_IS_DEV = resolveEnvDev(process.env)` = `env.NODE_ENV === 'development'`. The root Dockerfile's ENTRYPOINT is `sh -c 'exec bun run dev:${WORKSPACE}'`, and packages/site/package.json's `dev` script is `NODE_ENV=development bun src/index.ts` — an inline assignment that wins over any CapRover app env — and build.yml's site leg builds from that Dockerfile. So `development === true` in production. errors.ts:93 then sets `stack = development && thrown instanceof Error && typeof thrown.stack === 'string' ? thrown.stack : undefined`, and because index.ts sets no `errorPage`, Mochi.ts:669 falls back to `DEFAULT_ERROR_PAGE_PATH` → templates/DefaultError.svelte, which renders `{#if error.stack}<pre class="stack">{error.stack}</pre>{/if}`. Crucially, `error(status, msg)` throws `MochiHttpError extends Error` (utils/index.ts:82-92), which has a `.stack`, and page routes funnel every throw through `routeErrorResponse` (Mochi.ts:1016). So this is not limited to 500s as the finding suggests: a plain `GET /docs/nonexistent/` or `/blog/nonexistent/` hits `error(404, …)` and returns a 404 page containing a full stack trace with absolute server paths and the framework's internal call chain. The site's `handleError` hook returns `undefined` for all but one redirect path, so it never suppresses the stack, and `encodeDebugBarPaths` only rewrites the `window.__mochi_debug`/`__mochi_page_entry` script tags, not the `<pre>`. One supporting argument in the finding is wrong and I want to flag it: debugBarEncode.ts's own header says the base64url re-encode exists because "crawlers mine those slash-shaped strings as URLs, producing phantom Search Console hits" — an SEO motive, not secrecy, and it explicitly decodes "losslessly" client-side. So the deployed site already publishes its absolute build-time paths to every visitor by design, which makes the stack trace's incremental disclosure the internal call chain and framework internals rather than filesystem layout. That trims the impact but does not negate it: unauthenticated clients get server stack traces on every page 404/500, which is a genuine CWE-209 exposure. MEDIUM stands.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-11-14)
