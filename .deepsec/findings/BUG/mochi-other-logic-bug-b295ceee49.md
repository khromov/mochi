# [BUG] Non-directory entry in vendor/ (e.g. .DS_Store) aborts the whole run via unhandled rejection

**File:** [`scripts/check-vendored-versions.ts`](https://github.com/khromov/mochi/blob/main/scripts/check-vendored-versions.ts#L11-L45) (lines 11, 13, 15, 45)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

L11 uses `readdirSync(VENDOR_DIR)` without `withFileTypes`, so `dirs` contains every entry — files included — and L15 unconditionally does `Bun.file(`${VENDOR_DIR}/${name}/index.ts`).text()`. For a non-directory entry that read rejects with ENOENT. Because the reads are wrapped in `Promise.all` (L13) and `main()` is invoked with no `.catch()` (L45), the first rejection aborts the entire run as an unhandled promise rejection: no package is reported at all, not even the four with valid provenance comments, and the operator gets a raw ENOENT stack instead of an actionable message. The trigger is mundane on this repo: `.DS_Store` is listed in .gitignore (line 44), so macOS creates one in packages/mochi/src/vendor/ on any Finder visit and `git status` stays clean — the script simply starts failing with no visible cause in version control. The same crash occurs if a vendored package is ever laid out without an `index.ts` (split across multiple files). Note the inconsistency: the script already degrades gracefully for a *missing provenance comment* but hard-fails for a *missing file*.

## Recommendation

Use `readdirSync(VENDOR_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)`, wrap the per-entry read in try/catch so a missing index.ts becomes a per-package `{ name, error }` row like the missing-comment case, and add `main().catch((err) => { console.error(err); process.exit(1); })`.

## Revalidation

**Verdict:** true-positive

Confirmed, and distinct from F5 — different line range and a different root cause (directory enumeration vs. provenance parsing), so not a duplicate. L11 calls readdirSync(VENDOR_DIR) without { withFileTypes: true }, so `dirs` contains every entry including plain files, and L15 unconditionally awaits Bun.file(`${VENDOR_DIR}/${name}/index.ts`).text(). For a file entry the resulting path has a non-directory parent, so the read rejects (ENOTDIR/ENOENT). Because every read is inside Promise.all at L13 and main() is invoked with no .catch() at L45, the first rejection discards the whole batch: not one package is reported, including the four with valid provenance comments, and Bun surfaces it as an unhandled rejection with a raw stack rather than an actionable message. I verified the trigger is mundane rather than contrived: .DS_Store is listed at .gitignore L44, and this session's platform is darwin, so any Finder visit to packages/mochi/src/vendor/ creates one while `git status` stays clean — the script would simply start failing with no cause visible in version control (I confirmed `git status --short` is currently clean apart from an unrelated .deepsec/ directory, so no such file exists right now; this is latent, not currently firing). The same crash occurs for any future vendored package laid out across multiple files without an index.ts. The inconsistency the finding highlights is real and is the clearest argument for the fix: the script already degrades gracefully for a missing provenance comment (per-package error row) but hard-fails the entire run for a missing file. All three recommended changes — withFileTypes filtering, a per-entry try/catch producing an error row, and main().catch() — are correct.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-01)
