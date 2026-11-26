# [BUG] reportEarlyExit's kind filter rests on a stale invariant — protection-gate blocks on ws/sse/island emit no request event

**File:** [`packages/mochi/src/runtime/requestSetup.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/runtime/requestSetup.ts#L91-L134) (lines 91, 92, 93, 94, 95, 96, 130, 131, 134)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-observability-gap`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`reportEarlyExit` returns without emitting for any kind other than `page`/`api`/`file` (L94-96), justified by a comment asserting "only page and api can early-exit at all (trailingSlash, csrf)". That invariant no longer holds: the protection gate added at L130-136 runs for **every** kind (it is guarded only by `cfg.protection && !opts.skipProtection`, with no `KIND_POLICY` entry), and `KIND_POLICY` confirms `ws`, `sse` and `island` have both `trailingSlash: false` and `csrf: false` — so the protection gate is in fact the *only* way those kinds early-exit.

The result is that protection-mode blocks on the server-island endpoint (`kind: 'island'`, Mochi.ts:1559-1567), WebSocket upgrades and SSE streams are invisible to the `request` event, and therefore to `consoleLogger()` and any application observability built on the event bus. In protection mode that silently hides the bulk of blocked island traffic — exactly the signal an operator would use to tell a misconfigured gate apart from an attack.

## Recommendation

Either extend `MochiRequestKind` to cover ws/sse/island and emit for them, or emit the protection block under a dedicated event. In both cases update the stale comment, since trailingSlash and csrf are no longer the only early-exit paths.

## Revalidation

**Verdict:** true-positive

Confirmed, including the staleness. `reportEarlyExit` bails for any kind other than page/api/file (requestSetup.ts:94-96) on the stated grounds that 'only page and api can early-exit at all (trailingSlash, csrf)' — the comment doesn't even match its own code, which also admits `file`. That invariant is now false: the protection gate at L130-136 is guarded only by `cfg.protection && !opts.skipProtection`, with no `KIND_POLICY` entry, and `KIND_POLICY` gives `ws`, `sse`, `island` and `file` both `trailingSlash: false` and `csrf: false`, so the gate is the *only* early-exit route for those kinds. 152-protection.md confirms the gate is meant to fire for all of them ('pages, APIs, WebSockets, SSE, and unmatched URLs'), and `MochiRequestKind` in events.ts:5 is indeed `page|api|file|asset|image|fallback|error`, excluding ws/sse/island. Two refinements from tracing the emitters: successful island requests never emit a `request` event either (Mochi.ts:1689-1694 just returns), so for islands this is a hole in an uninstrumented surface rather than a one-sided blind spot; but ws and sse already report their own rejections through the existing `kind: 'error'` escape hatch (`emitWsReject` at Mochi.ts:1271-1280, the SSE HEAD 405 at :1346-1354), so the precedent for emitting these exists and the only reason protection blocks go unreported is the stale narrowing. Net effect is as described — in protection mode, blocked island/ws/sse traffic is invisible to `consoleLogger()` and to any event-bus observability, which is the signal an operator would use to distinguish a misconfigured `protect()` from an attack. BUG severity is right.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-19)
