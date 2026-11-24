# [MEDIUM] Decrypted server-island props are inlined into every page response whenever the debug bar is enabled — a configuration this project deploys in production

**File:** [`packages/mochi/src/islands/serverIslandCrypto.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/islands/serverIslandCrypto.ts#L35-L42) (lines 35, 36, 37, 38, 39, 40, 41, 42)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-info-disclosure`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`encryptProps` seals props so they are "opaque ciphertext on the wire" (header comment L1-5; the preprocessor comment at svelteAstPreprocess.ts:297-299 states props are "encrypted against reads and tampering via query parameters"). Lines 35-42 then write the **decrypted plaintext** of that same payload into `ctx.debugBarData.serverProps[token]`, keyed by the very token the client sees. That bag is snapshotted onto `RenderResult.debugBarData` (ComponentRegistry.ts:1801-1802) and emitted into the HTML as `<script>window.__mochi_debug=${jsonForHtml(opts.debugInfo)}</script>` (Mochi.ts:356), readable by every visitor and by any script on the page. The encryption's confidentiality property is fully defeated for the duration.

The guard is `debugBarEnabled = development && (options.debugBar ?? true)` (Mochi.ts:503) — a build flag, not auth — and this is not a dev-only path in practice:
- `packages/site/src/lib/debugBarEncode.ts:1` says verbatim: "This site runs in dev mode in production to show the debug bar". Its base64url rewrite is explicitly cosmetic (to stop crawlers mining paths), not a protection; the client decodes it losslessly.
- CLAUDE.md records `Dockerfile` as "dev-mode image (the variant deployed for site + demos)", and that image runs `bun run dev:<workspace>`, which sets `NODE_ENV=development`.
- `types.ts:481-483` documents this as a supported shape: keep "the debug bar without the socket, for production-like deployments".

So any app following the framework's own deployment pattern publishes the plaintext of every `mochi:defer` props bag. Server islands exist specifically to render server-side data, so those bags are the natural home for internal ids, record contents, and API results.

Severity is reinforced by what else rides the same `debugBarData` bag it feeds: `appendDebugTail` ships `requestCookies: ctx.cookies.peekAll()` (Mochi.ts:192-194) — i.e. every request cookie, `HttpOnly` ones included, into page-readable JavaScript. The props snapshot is one contributor to a bag that should never be emitted on an internet-facing response.

## Recommendation

Do not record decrypted props in a bag that is serialized into the page. Either gate the recording on a stricter signal than `development` (e.g. an explicit `debugBar: 'unsafe-inline-server-data'` opt-in, or localhost-only), or keep the snapshot server-side and have the debug bar fetch it from a dev-only, non-prerenderable endpoint keyed by the token. At minimum, make `encryptProps`' recording conditional on the same check that would refuse to emit request cookies.

## Revalidation

**Verdict:** true-positive

Every step of this one checks out against the source. `encryptProps` writes the devalue-parsed *plaintext* of the props it just sealed into `ctx.debugBarData.serverProps[token]` (serverIslandCrypto.ts:35-42), keyed by the exact token the client holds. `renderComponent` shallow-copies that bag onto `RenderResult.debugBarData` (ComponentRegistry.ts:1801-1802), the page handler spreads it into `debugInfo` (Mochi.ts:951), and `createShellRenderer` emits `<script>window.__mochi_debug=${jsonForHtml(opts.debugInfo)}</script>` into the body whenever `registry.debugBarEnabled` (Mochi.ts:356) — readable by every visitor and by any script on the page, which is a complete defeat of the confidentiality property the module header and svelteAstPreprocess.ts:297-299 both claim for these tokens. The gate is a build flag, not auth: `debugBarEnabled = development && (options.debugBar ?? true)` (Mochi.ts:503), and `ctx.debugBarData` is populated only for `page` kind under that flag (requestSetup.ts:150-159). The 'dev mode in production' claim is verified end to end, not inferred: `packages/site/src/lib/debugBarEncode.ts:1` states it outright, its base64url rewrite is explicitly cosmetic anti-crawler encoding that the client decodes losslessly, `packages/site/package.json` sets `"dev": "NODE_ENV=development bun src/index.ts"`, and the deployed `Dockerfile` ends with `ENTRYPOINT sh -c "exec bun run dev:${WORKSPACE}"` — so the shipped image runs with `development: true`. `types.ts:478-483` documents keeping the debug bar with `liveReload: false` for 'production-like deployments', making this a supported configuration rather than an accident. The corroborating detail is also accurate: `appendDebugTail` puts `ctx.cookies.peekAll()` — every request cookie, `HttpOnly` included — into the same page-readable global (Mochi.ts:192-194), and the comment at Mochi.ts:179-181 confirms the static `__mochi_debug` fields are baked into the *cached* body, so with page caching one visitor's decrypted props can be served to another. The deployed site's own island props are demo data, which is why I keep MEDIUM rather than raising it, but the framework-level disclosure is real and the recommendation (don't record plaintext into a bag that is serialized into the page) is the right fix.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-27)
