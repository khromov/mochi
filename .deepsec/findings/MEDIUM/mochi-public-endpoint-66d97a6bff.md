# [MEDIUM] Dev email outbox viewer and attachment download are unauthenticated and reachable in production deployments

**File:** [`packages/mochi/src/dev/emailViewerRoutes.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/dev/emailViewerRoutes.ts#L48-L72) (lines 48, 53, 70, 72)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `public-endpoint`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`buildEmailViewerRoutes` mounts `/_mochi/email` (full message view) and `/_mochi/email/attachment` (raw attachment bytes) with no authentication, no authorization and no network restriction. The only gate is `emailViewerEnabled = development && emailTransportType === 'dev'` (Mochi.ts:619), and the code comments make the trust assumption explicit: "Dev-only (only mounted while the `dev` transport is active), so no auth beyond that gate" (L70-71).

That assumption does not hold for this project's own deployment model. The root `Dockerfile` — which CLAUDE.md names as "the variant deployed for site + demos" — ends in `ENTRYPOINT [ "sh", "-c", "exec bun run dev:${WORKSPACE}" ]` and documents that it runs with `NODE_ENV=development` on purpose. `packages/site/src/index.ts` passes no `email` option, and `resolveEmailOptions` (email/config.ts:8-15) defaults the transport to `{ type: 'dev' }` whenever `development` is true. So on the deployed site/demos, `emailViewerEnabled` is true and both routes are live on the public internet.

Anything in the in-memory outbox is then world-readable: recipients, subject, custom headers, full HTML and text bodies (`serverProps` returns the whole `StoredEmail` minus attachment bytes, L53-61), plus every attachment's raw bytes via the second route (L72-99). Any visitor can also wipe the outbox through the `clear` action (L64-67) — CSRF protects it from cross-site forgery but nothing restricts who may call it directly. For any app deployed this way, this is a disclosure of password-reset links, magic links, email-verification tokens and invite codes — exactly the one-time credentials transactional mail carries. (The same `development` flag also flips `filterPii` to `false` in `resolveEmailOptions`, so those recipients and subjects are additionally written to the server log.)

Secondary exposure path, independent of deployment: `Mochi.serve` forwards `hostname` unchanged to `Bun.serve`, and none of the apps set it, so Bun binds `0.0.0.0`. A dev running `bun run dev` on a shared/untrusted network exposes the same two unauthenticated routes to every host on that network.

On mochi.fast specifically the captured mail is fixed demo content (`demos/email/routes.ts` validates a preset id and hardcodes recipient/subject/attachment), so present impact on that site is limited — the defect is the framework gate plus the deployment pattern the repo ships and documents.

## Recommendation

Stop treating `development` as an authorization boundary for a route that serves message bodies. Options, best first: (1) require an explicit opt-in that cannot be satisfied by `NODE_ENV` alone (e.g. mount only when `options.email?.devViewer === true`, or only when `development && !process.env.MOCHI_DOCKER`); (2) bind the internal dev routes to loopback only — reject the request when `server.requestIP(req)?.address` is not a loopback address; (3) at minimum, set `debugBar: false` plus `email: { transport: { type: 'log' } }` in `packages/site`/`packages/demos` so the dev-mode image stops publishing the outbox, and log a loud boot warning when the email viewer is mounted while the process is listening on a non-loopback interface.

## Revalidation

**Verdict:** true-positive

The code claim is exactly right: `buildEmailViewerRoutes` mounts a page that returns the whole `StoredEmail` (recipients, subject, headers, html, text) plus an API that streams raw attachment bytes, with no auth, no peer check and a self-documented 'no auth beyond that gate' comment; `clear` wipes the outbox and is reachable by any direct caller since CSRF only compares `Origin`, which an attacker sets freely. I verified the reachability chain end-to-end rather than taking it on trust: `Mochi.ts:619` gates on `development && emailTransportType === 'dev'`; `resolveEmailOptions` (email/config.ts:12) defaults the transport to `dev` whenever `development`; `packages/site/src/index.ts` passes no `email` option; the root `Dockerfile` — commented as the variant deployed for site + demos — ends in `ENTRYPOINT exec bun run dev:${WORKSPACE}` and `packages/site/package.json` defines `dev` as `NODE_ENV=development bun src/index.ts`. So `emailViewerEnabled` is true and both routes are public on the deployed hosts; nothing in site's `sequence()` or the `/demos/protection*`-scoped protection gate blocks `/_mochi/*`, and the proxy cannot blanket-block that prefix because client bundles live under it. The generic attack is concrete and does not need undelivered-mail to be harmless: with a broken/absent transport an attacker triggers a magic-link or verification mail for a victim address, reads the captured token from the public outbox, and redeems it — the token is valid to the app even though nothing was delivered. I am lowering HIGH to MEDIUM for three verified reasons: `packages/docs/170-development-mode.md:44` is an explicit 'Never run development mode in production' directive, so the mode flag is a documented boundary rather than an accidental one; the `dev` transport implies mail is not being delivered at all, narrowing the realistic exposure window; and on the two hosts actually deployed this way the impact is near-nil — `packages/site/src/demos/email/routes.ts` validates a preset id and hardcodes recipient/subject/attachment, and `packages/demos` contains no `Mochi.email()` call at all, so the outbox holds only canned demo content. The defect worth fixing is the framework's use of `NODE_ENV` as the sole authorization for a route that serves message bodies and accepts a state-mutating action.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-27)
