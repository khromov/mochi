# [BUG] SqliteNonceStore never creates its parent directory, and the failed lazy construction is not cached so it 500s on every request

**File:** [`packages/mochi/src/captcha/nonceStore.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/captcha/nonceStore.ts#L27-L28) (lines 27, 28)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`new Database(path, { create: true })` at L28 will create the database file but not the directories leading to it, so a storePath whose parent is missing throws SQLITE_CANTOPEN. Every other sqlite-backed store in the framework guards against this: queue.ts:492 calls `mkdirSync(path.dirname(path.resolve(file)), { recursive: true })` before opening, and cache-storage.ts:301 does the same for its directory. This store does neither. The failure mode is made worse by lazy construction: getCaptchaRuntime (config.ts:73-83) only assigns `g[GLOBAL_KEY] = runtime` at L80, after createStore has returned, so a throwing constructor leaves nothing cached and the attempt repeats on every subsequent request. Because the runtime is built on first use (captcha.ts:44, from mintCaptcha during a page render) rather than at boot except when protection is enabled (Mochi.ts:672), an app configured with e.g. `captcha: { store: 'sqlite', storePath: 'data/nonces.sqlite' }` and no data/ directory starts up perfectly clean and then returns an unending stream of 500s from the first captcha-bearing page onward.

## Recommendation

mkdirSync(path.dirname(path.resolve(path)), { recursive: true }) in the constructor before opening the database, mirroring queue.ts:492. Separately, validate the captcha store eagerly at boot (as protection already forces) so a bad storePath fails startup rather than the request path.

## Revalidation

**Verdict:** true-positive

Confirmed on all three legs. (1) `new Database(path, { create: true })` at L28 creates the file but not its parent directories — SQLite returns SQLITE_CANTOPEN for a missing directory — and this repo states it outright: support/src/db.server.ts:67 carries the comment 'bun:sqlite won't create the parent directory.' immediately above its own `mkdirSync`. (2) The cited precedents are real: queue.ts:492 is `mkdirSync(path.dirname(path.resolve(file)), { recursive: true })` before constructing the SQL handle, and cache-storage.ts:301 does `mkdirSync(this.directory, { recursive: true })`; SqliteNonceStore does neither. (3) The non-cached-failure amplification is real: config.ts:73-83 assigns `g[GLOBAL_KEY] = runtime` only after `createStore(resolved)` returns, so a throwing constructor leaves the global unset and the construction is retried — and rethrown — on every subsequent request. I verified the boot-vs-request timing claim too: grepping `getCaptchaRuntime` shows the only non-captcha.ts caller is Mochi.ts:672, guarded by `protectionEnabled && options.protection`, and `resolveCaptchaOptions` is reachable only through `getCaptchaRuntime`. So with protection off, the runtime (and the store) is built lazily on the first `mintCaptcha` during a page render, and a bad `storePath` yields a clean startup followed by an unending stream of 500s. The default path is safe — Mochi.ts:602 mkdirs outDir subdirectories, so `.mochi/` exists — which correctly scopes this to a custom `storePath` with a missing parent (e.g. `data/nonces.sqlite`), a configuration the support app exposes directly via its `CAPTCHA_NONCE_DB` env var. BUG severity is right; both recommendations (mkdir in the constructor, validate the store eagerly at boot) follow existing in-repo patterns.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-17)
