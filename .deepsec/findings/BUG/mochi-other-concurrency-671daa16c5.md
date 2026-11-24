# [BUG] SqliteNonceStore opens the database without WAL or a busy_timeout, in the exact configuration the docs recommend for multi-instance deploys

**File:** [`packages/mochi/src/captcha/nonceStore.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/captcha/nonceStore.ts#L28-L41) (lines 28, 29, 32, 39, 40, 41)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-concurrency`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The constructor opens the file with `new Database(path, { create: true })` (L28) and sets no pragmas. Bun's SQLite documentation is explicit that WAL is not the default and must be enabled with `db.run('PRAGMA journal_mode = WAL;')`; no busy_timeout is set either, and SQLite's default busy handler returns SQLITE_BUSY immediately. Meanwhile consume() takes a write transaction on every single call — an unconditional DELETE at L39 followed by the INSERT at L40 — and in rollback-journal mode each commit fsyncs while holding an EXCLUSIVE lock on the whole database, widening the collision window considerably. This matters because 150-captcha.md directs multi-instance deploys to this exact store: 'Use store: sqlite with shared storage' — i.e. several processes writing one file concurrently, which is precisely the case rollback-journal mode handles worst (and on network storage such as NFS/EFS SQLite's locking is unreliable outright). When a writer loses the race, consume() throws SQLITE_BUSY; verifyCaptcha wraps neither `store.consume` call (captcha.ts:118) nor consumeCaptcha (captcha.ts:151) in a try/catch, so the exception propagates out of the application's form action as a 500 and the visitor's genuinely solved captcha is burned. That the project knows the fix is visible at packages/support/src/db.server.ts:69, which does `db.exec('PRAGMA journal_mode = WAL')`; this store is the only sqlite-backed store in the framework that omits it.

## Recommendation

Run `PRAGMA journal_mode = WAL` and set a busy timeout (e.g. db.run('PRAGMA busy_timeout = 5000')) in the constructor, matching packages/support/src/db.server.ts. Consider skipping the DELETE on most calls (amortise the prune) so a read-mostly consume does not take a write lock, and decide deliberately whether a store exception should surface as a 500 or as a generic captcha failure.

## Revalidation

**Verdict:** true-positive

Every factual element checks out. The constructor (L27-33) is `new Database(path, { create: true })` followed only by two DDL statements — no pragmas at all. I confirmed against Bun's own documentation (bun.com/docs/runtime/sqlite, 'WAL mode') that WAL is not the default and must be enabled with `db.run("PRAGMA journal_mode = WAL;")`, and found no documented default `busy_timeout` anywhere in the Bun docs; SQLite's own default is no busy handler, so a losing writer gets SQLITE_BUSY immediately. Meanwhile `consume()` takes two separate implicit write transactions on every call — an unconditional `DELETE … WHERE expires_at < ?` at L39 then the `INSERT OR IGNORE` at L40 — and in rollback-journal mode each commit fsyncs under an EXCLUSIVE whole-database lock. The configuration this breaks is the one the docs prescribe: 150-captcha.md:195 says 'Use `store: 'sqlite'` with shared storage' for multi-instance deploys, which means several processes writing one file (and on NFS/EFS, SQLite's advisory locking is unreliable outright). I verified the error propagation: neither `store.consume` at captcha.ts:118 nor `consumeCaptcha` at captcha.ts:151 is wrapped, so a SQLITE_BUSY throw escapes the application's form action. I also confirmed the cited precedent precisely — grepping every `new Database(` in the repo returns exactly two file-backed opens, and support/src/db.server.ts:69 is the only one that runs `PRAGMA journal_mode = WAL`, making SqliteNonceStore the lone sqlite store in the project without it. BUG is the right severity: this is an availability/robustness defect under concurrency, not a boundary bypass. My only residual uncertainty is whether bun:sqlite sets an undocumented internal busy_timeout; the WAL half is certain regardless, and the absence of any pragma is the substance of the finding.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-17)
