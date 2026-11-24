# [BUG] `proxy.hostHeader` alone silently 403s every production form POST, and suppresses the boot warning designed to catch exactly that

**File:** [`packages/mochi/src/runtime/csrf.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/runtime/csrf.ts#L81-L149) (lines 81, 133, 149)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`expectedOriginConfigured` (L133) treats `proxy.hostHeader` as sufficient on its own, and `csrfBootWarning` (L81) returns null as soon as `hostHeader` is set. But with only `hostHeader` configured, `resolveExpectedOrigin` (proxy.ts:66-81) takes the protocol from `url.protocol` — the socket URL, which is `http:` behind a TLS-terminating proxy — and yields `http://app.example.com`, while the browser sends `Origin: https://app.example.com`. `normalizeOrigin` strips only `:443`/`:80`, never the scheme, so the comparison at L153 fails and every form-action POST returns 403 in production. The failure mode is precisely the production-only breakage `csrfBootWarning` exists to surface (see its doc comment at L70-73), yet the partial configuration that causes it is the one input that silences the warning. Dev is unaffected (L160-165 only warns), so this ships undetected.

## Recommendation

Treat `hostHeader` without `protocolHeader` (or `origin`) as an incomplete configuration: either have `csrfBootWarning` emit a dedicated warning for that combination, or make `resolveExpectedOrigin` scheme-agnostic when the protocol was not explicitly configured (compare host only), or require `origin`/`protocolHeader` alongside `hostHeader` before setting `expectedOriginConfigured`.

## Revalidation

**Verdict:** true-positive

This is the same underlying defect as F2, seen from csrf.ts rather than proxy.ts — and because the duplicate verdict is only valid within a single file, both get real verdicts. The csrf.ts-side facts are all confirmed: `csrfBootWarning` short-circuits to null on `options.proxy?.hostHeader` (L81), `expectedOriginConfigured` is `Boolean(proxy?.origin || proxy?.hostHeader)` (L133), `normalizeOrigin` (L37-45) touches only the default-port suffix so a scheme mismatch can never be reconciled at L153, and the dev branch at L160-165 merely warns. Combined with `resolveExpectedOrigin`'s protocol fallback to `url.protocol` (proxy.ts:74), a `hostHeader`-only deployment behind TLS termination compares `http://app.example` to `https://app.example` and 403s every protected form submission — the precise production-only breakage the L70-73 doc comment says the boot warning exists to surface, suppressed by the very configuration that causes it. Worth adding: the same partial config also silently breaks protection mode, since 152-protection.md:97 notes the verify POST rides the same CSRF check, so an uncleared visitor would exhaust `maxAttempts` and be told their browser can't be verified. The recommendation is sound and the cheapest variant is the scheme-agnostic comparison when no `protocolHeader` was configured, or requiring `protocolHeader`/`origin` before treating the origin as configured. Leaving the filed BUG severity alone — F2 carries the headline severity for this defect.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-18)
