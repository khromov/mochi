# [BUG] `protect` JSDoc states publicDir files are never gated, contradicting the default `protectFiles: true`

**File:** [`packages/mochi/src/protection/types.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/protection/types.ts#L16-L31) (lines 16, 31)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-doc-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The JSDoc on `protect` (L13-17) tells the reader that "Framework client assets, `publicDir` files, warmup self-requests, the verify endpoint, and unmatched 404s are never gated." Listing `publicDir` files there is wrong, and it is contradicted by three independent sources:

1. `config.ts:43` resolves `protectFiles: opts.protectFiles ?? true` — gating is the default.
2. `Mochi.ts:1845-1859` builds `publicRouteGuard` whenever `protectionRuntime && protectionRuntime.options.protectFiles` and runs the gate with `kind: 'file'` before serving any static file.
3. `packages/docs/152-protection.md:51` states the opposite in bold: "`publicDir` static files **are** gated (as kind `file`) — set `protectFiles: false` to leave them open", and `protectionServe.test.ts:115-126` asserts exactly that (403 without clearance, 200 with).

The same JSDoc block also omits the image and local-asset endpoints, which the docs do list as never-gated. Since this is the tooltip a developer sees in their editor while writing `protect()`, the practical effect is an operator believing their static assets are publicly reachable when they are in fact behind the gate (or not realizing `protectFiles: false` is the knob that opens them) — a real risk of misconfiguring a deployment's expected availability.

## Recommendation

Correct the `protect` JSDoc to match `152-protection.md:51` — drop `publicDir` files from the never-gated list, note that they are gated as kind `file` subject to `protectFiles`, and add the image and local-asset endpoints to the never-gated list.

## Revalidation

**Verdict:** true-positive

Straightforwardly correct, and the file contradicts itself. The `protect` JSDoc at types.ts:13-17 reads 'Framework client assets, `publicDir` files, warmup self-requests, the verify endpoint, and unmatched 404s are never gated' — yet 14 lines later in the *same interface*, the `protectFiles` doc comment at types.ts:31 says 'Gate `publicDir` static files too (subject to `protect()`). Default: `true`.' I verified all three corroborating sources the finding cites: `config.ts:43` resolves `protectFiles: opts.protectFiles ?? true`; `Mochi.ts:1845-1859` builds `publicRouteGuard` whenever `protectionRuntime && protectionRuntime.options.protectFiles` and runs `protectionRuntime.gate({ ..., kind: 'file' })` before `serve()`, passing it to `registerPublicRoutes`; and `packages/docs/152-protection.md:51` states the opposite in bold — 'publicDir static files **are** gated (as kind `file`) — set `protectFiles: false` to leave them open'. The test coverage confirms the runtime behaviour: `protectionServe.test.ts` has 'publicDir static files are gated by default (protectFiles) and open with clearance', asserting 403 for `/hello.txt` with no cookie and 200 (plus `Vary: Cookie`) with clearance. The secondary claim also holds: docs L51 lists 'the image and local-asset endpoints' among the never-gated surfaces and the JSDoc omits them. Since this JSDoc is the editor tooltip a developer reads while writing `protect()`, the realistic consequence is an operator believing static assets stay publicly reachable when they are in fact behind the gate, or not discovering `protectFiles: false`. No exploit path — it is a documentation defect with deployment-availability consequences, so BUG is correct.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-19)
