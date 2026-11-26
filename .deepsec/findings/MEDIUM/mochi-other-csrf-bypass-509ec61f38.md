# [MEDIUM] Deployed site/demos image runs NODE_ENV=development, which degrades CSRF origin enforcement to warn-and-allow

**File:** [`Dockerfile`](https://github.com/khromov/mochi/blob/main/Dockerfile#L5-L79) (lines 5, 79)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-csrf-bypass`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

This is the image deployed for both internet-facing apps: .github/workflows/build.yml sets `dockerfile: Dockerfile` for the `site` (L43) and `demos` (L54) matrix legs, which are then deployed via CapRover. Its ENTRYPOINT (L79) runs `bun run dev:${WORKSPACE}`, and packages/site/package.json:14 defines that as `NODE_ENV=development bun src/index.ts`.

That flows straight into the framework's CSRF gate:
1. packages/mochi/src/utils/env.ts:13 — `resolveEnvDev` returns `env.NODE_ENV === 'development'`, so `SEEDED_IS_DEV === true`.
2. packages/mochi/src/Mochi.ts:479 — `const development = options.development ?? SEEDED_IS_DEV`. packages/site/src/index.ts never passes `development`, so it resolves to `true`.
3. packages/mochi/src/runtime/requestSetup.ts:62-64 — `KIND_POLICY` enables `csrf: true` for `page` and `api`; L119-120 call `csrfCheck(req, url, cfg.csrf, cfg.proxy, cfg.development, ...)`.
4. packages/mochi/src/runtime/csrf.ts:160-165 — after the Origin comparison fails, `if (development) { logger.warn(...); return null; }`. Returning `null` means *pass*.

The site does configure `proxy: { origin }`, so the `expectedOriginConfigured` short-circuit at csrf.ts:133-147 is not what fires — execution reaches the mismatch branch and is waved through. Net effect: every state-mutating form POST/PUT/PATCH/DELETE to a `Mochi.page` action or `Mochi.api` route on the deployed sites accepts an arbitrary (or absent) `Origin` header. An attacker-controlled page can auto-submit a cross-origin form with the victim's cookies attached and the submission succeeds; the only trace is a server-side warning.

The Dockerfile's header comment (L5-6) justifies dev mode as making "the debug bar and dev overlays" visible in the deployed environment — it does not mention that it also turns off the framework's only CSRF control, so this looks like an unintended side effect of a deliberate choice rather than an accepted risk. Practical blast radius on these two specific deployments is limited because the mutating actions are demo-grade state (login/todo/cookies demos, HN clone), but the control is globally off for the whole app, and this Dockerfile is the reference pattern a framework user would copy for an app with real actions.

## Recommendation

Don't ship `NODE_ENV=development` to an internet-facing deployment. Either build site/demos from Dockerfile.production (`bun run start`), or keep the dev entrypoint but decouple the debug bar from the CSRF decision — e.g. run with NODE_ENV unset and pass `Mochi.serve({ debugBar: true })` explicitly, since `debugBarEnabled = development && (options.debugBar ?? true)` (Mochi.ts:503) is the only thing the comment actually wants. Separately, consider making the csrf.ts:160-165 dev bypass opt-in (`csrf.allowOriginMismatchInDev`) so dev convenience can never be inherited by a deployed process.

## Revalidation

**Verdict:** true-positive

Every link in the chain verifies. `.github/workflows/build.yml` sets `dockerfile: Dockerfile` for the `site` (L41-48) and `demos` (L53-59) legs and both are deployed to CapRover in the `deploy` job (L233-240). Dockerfile L79 is `ENTRYPOINT ["sh","-c","exec bun run dev:${WORKSPACE}"]`; root `dev:site`/`dev:demos` delegate to each workspace's `dev` script, and both `packages/site/package.json:14` and `packages/demos/package.json:11` are `NODE_ENV=development bun src/index.ts`. `utils/env.ts:12-17` makes `SEEDED_IS_DEV` true; `Mochi.ts:479` resolves `development` from it (site passes no `development`; demos passes `process.env.NODE_ENV === 'development'`, same result). `requestSetup.ts:62-64` sets `csrf: true` for `page` and `api` and L119-120 forwards `cfg.development` into `csrfCheck`, which lands at `csrf.ts:160-165` — on an Origin mismatch it logs `logger.warn` and `return null`, and null means pass. Because the site configures `proxy: { origin }` (index.ts:201) the `expectedOriginConfigured` short-circuit at L133-147 is indeed not what fires, exactly as the finding states; execution reaches the mismatch branch. I confirmed a concrete cross-site attack shape: a page on evil.com auto-submitting `POST https://mochi.fast/demos/email/` (`preset=welcome`) or `/demos/queue/` is accepted and runs the action, where production mode returns 403. Note a corollary that supports the "unintended side effect" reading — `origin` is built from `MOCHI_DOMAIN`/`MOCHI_PORT`, neither set in the Dockerfile, so it resolves to `http://localhost:3333`, meaning the dev bypass is currently what keeps the site's own legitimate forms working at all. I downgrade HIGH→MEDIUM on blast radius, which I checked rather than assumed: `packages/demos` declares zero form actions and zero mutating POST routes (hn/todo/admin routes are all GET pages plus one read-only API), and on `packages/site` the only credential-bearing cookie is the login demo's, set with `sameSite: 'Lax'` (demos/login/routes.ts:28), which browsers do not send on a cross-site POST — so no privilege-bearing cross-site mutation is demonstrable today. The control being globally off on an internet-facing deployment is still real, and the Dockerfile is the reference pattern a framework user would copy.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-10-26)
