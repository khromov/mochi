# [HIGH_BUG] hostHeader without protocolHeader produces a scheme-mismatched CSRF origin, 403ing every production form POST while silencing the boot warning built to catch exactly that

**File:** [`packages/mochi/src/runtime/proxy.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/runtime/proxy.ts#L62-L81) (lines 62, 66, 74, 81)
**Project:** mochi
**Severity:** HIGH_BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`resolveExpectedOrigin` derives the protocol from `url.protocol` whenever `protocolHeader` is unset (L74). Behind a TLS-terminating reverse proxy — the deployment this whole module exists for — Bun serves plain HTTP, so `url.protocol` is `http:` and the expected origin becomes `http://my.site`, while the browser sends `Origin: https://my.site`. `normalizeOrigin` in csrf.ts only strips default ports (`:443`/`:80`); it never reconciles schemes, so the comparison at csrf.ts:153 always fails.

The trap is that this configuration *looks* correct and silences the framework's own early-warning system: `csrfBootWarning` (csrf.ts:81) returns null as soon as `proxy.hostHeader` is set, and `csrfCheckDefault` treats `expectedOriginConfigured` as true (csrf.ts:133). So the operator gets no boot warning, dev mode only warns per-request and lets requests through (csrf.ts:160-165), and the failure appears for the first time in production as a blanket 403 on every POST/PUT/PATCH/DELETE carrying a form content type — i.e. every form action on the site. The framework's own test asserts this derivation (proxy.test.ts:70-73: `hostHeader` alone → `http://public.example`), so the behaviour is pinned rather than accidental.

This repo's own deployed apps all pass `proxy.origin` explicitly (site/support/demos `index.ts`), so they are unaffected — the impact lands on `mochi-framework` consumers who pick the `hostHeader` route the docstring advertises as equivalent.

## Recommendation

Either default the protocol to `https` when `hostHeader` is configured but `protocolHeader` is not (a forwarded-host deployment is virtually always TLS-terminated), or make `csrfBootWarning` require `proxy.origin || (proxy.hostHeader && proxy.protocolHeader)` so the hostHeader-only config warns at boot instead of failing silently in production. Comparing only `host` (ignoring scheme) when no `protocolHeader` is configured is a third option.

## Revalidation

**Verdict:** true-positive

Every link in the chain checks out. `resolveExpectedOrigin` returns early on `options.origin` (proxy.ts:58) but otherwise takes the protocol from `url.protocol` whenever `protocolHeader` is unset (L74), and `url` comes from `new URL(request.url)` — plain `http:` for a Bun server behind a TLS-terminating proxy. `normalizeOrigin` (csrf.ts:37-45) strips only `:443`/`:80` and never reconciles schemes, so csrf.ts:153 compares `http://app.example` against the browser-sent `https://app.example` and always fails, yielding the 403 at csrf.ts:171 for every POST/PUT/PATCH/DELETE with a form content type. The silencing half is equally real: `csrfBootWarning` returns null the moment `proxy.hostHeader` is set (csrf.ts:81) and `expectedOriginConfigured` is `Boolean(proxy?.origin || proxy?.hostHeader)` (csrf.ts:133), so neither the boot warning nor the prod-hard-block path fires. Dev is clean too — I traced it: in dev no `x-forwarded-host` arrives, `rawHost` falls back to `url.host` (`localhost:3333`), expected origin equals the browser's Origin, and the request passes with no warning at all, so nothing surfaces before deploy. The behaviour is pinned by proxy.test.ts ('hostHeader alone uses url.protocol' → `http://public.example`), and the docs actively advertise the broken config: 160-serve-options.md:182 and 152-protection.md:97 both say `proxy.origin` *or* `proxy.hostHeader` satisfies the CSRF requirement. I confirmed the finding's scoping claim — site, support and demos all pass `proxy.origin` explicitly (site/index.ts:201, support/index.ts:38, demos/index.ts:27), so the impact lands on external `mochi-framework` consumers, not this repo. Fails closed, so it is an availability/correctness bug rather than an exposure; HIGH_BUG is defensible given it silently breaks every form mutation in production.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-27)
