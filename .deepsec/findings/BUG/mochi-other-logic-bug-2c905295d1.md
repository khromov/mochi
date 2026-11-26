# [BUG] buildTransport silently returns undefined for an unrecognized transport type instead of failing fast at boot

**File:** [`packages/mochi/src/email/transports.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/email/transports.ts#L13-L23) (lines 13, 14, 20, 23)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The switch in buildTransport (L14-23) has no `default` branch, so an unrecognized `config.type` falls through and the function returns `undefined`. It also does not check that a `custom` transport actually carries a `send` function (L20). Neither is validated at boot: resolveEmailOptions (config.ts:10-14) copies `o.transport` through untouched, and the transport is built lazily on the first send via `runtime.transport ??= buildTransport(...)` (mailer.ts:127).

Failure scenario: an app assembles its transport config dynamically from env — exactly what packages/support/src/index.ts:22-29 does — and a typo or a JS consumer produces `{ type: 'ses', ... }`. The server boots clean and accepts traffic; the first actual send then throws `TypeError: Cannot read properties of undefined (reading 'send')` from mailer.ts:129 — after the HTTP request was accepted and, in support's case, after the job was already enqueued to the durable store, where it burns all three retry attempts and marks the submission `failed`. Because `??=` never caches the `undefined`, every subsequent send repeats the same opaque crash. This diverges from the fail-fast convention Mochi.serve applies to its other options ('Same fail-fast rule: an unmountable prefix rejects here rather than 404ing at runtime', Mochi.ts:472).

## Recommendation

Add a `default:` branch throwing an EmailError that names the accepted types (mirroring the cronStorage message in Mochi.ts:469), and assert `typeof config.send === 'function'` for the custom transport. Better still, validate the transport shape in resolveEmailOptions so a misconfiguration is rejected during Mochi.serve() rather than on the first send.

## Revalidation

**Verdict:** true-positive

The code facts are exactly as described. The switch at transports.ts:14-23 covers `log`/`dev`/`custom`/`smtp` with no `default:`, so an unrecognized `config.type` falls off the end and the function returns `undefined` despite its declared `EmailTransport` return type (TS permits this only because it proves the union exhaustive). `new CustomTransport(config.send)` is likewise unchecked, so a `custom` entry without `send` yields `this.sendFn === undefined`. I confirmed nothing validates this at boot: `resolveEmailOptions` (config.ts:10-14) copies `o.transport` straight through, `getEmailRuntime` casts `options.email` from `unknown`, and `Mochi.ts:616` only reads `.transport.type` for the viewer gate — it never checks it against the known set, unlike the explicit fail-fast throws right beside it for `cron` names, `cronStorage` and `staticDirs` (Mochi.ts:459-473). The failure mode is as stated: `runtime.transport ??= buildTransport(...)` (mailer.ts:127) assigns `undefined`, `??=` therefore never caches it, and `transport.send(filtered)` at L129 throws an opaque `TypeError: Cannot read properties of undefined (reading 'send')` on every send — and in `packages/support` that happens inside a durable queue job that burns all three attempts and marks the submission `failed` (jobs.server.ts:40-50). The honest caveat, which I weighed carefully: TypeScript's discriminated-union exhaustiveness makes both sub-cases unreachable for a consumer writing a literal config, so this needs a cast, an `any`-typed config object, or a plain-JS consumer (mochi publishes raw TS, so JS projects get no enforcement at all). That compile-time barrier is why I am keeping this at BUG rather than treating it as a security issue — it is a real missing fail-fast guard that is inconsistent with the repo's own stated convention, not a defect reachable in idiomatic TS usage. The recommended fix (a `default:` throw naming the accepted types, plus a `typeof config.send === 'function'` assertion, ideally hoisted into `resolveEmailOptions`) is correct.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-10-30)
