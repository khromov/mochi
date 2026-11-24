# [MEDIUM] Agent-instruction file written from an unauthenticated, env-overridable URL with the review gate skipped on first write

**File:** [`packages/mochi/src/cli/updateSkill.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/cli/updateSkill.ts#L63-L89) (lines 63, 74, 86, 89)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-unverified-remote-instructions`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`updateSkill()` fetches a document and writes it to `.claude/skills/mochi/SKILL.md` (or the `.opencode`/`.agents` equivalents), a path coding agents auto-load as instructions. The docs (`packages/docs/183-cli.md`, "Confirming an update") treat the diff-and-confirm prompt as the safety control for exactly this reason: "The hosted SKILL.md is instructions your coding agent will follow." Three gaps weaken that control:

1. **The gate is conditional on the file already existing.** L86 reads `if (!created && confirmUpdate && !(await confirmUpdate(...)))`. On a first write — the common case right after `create-mochi` scaffolding — `confirmUpdate` is never invoked, so L89 writes remote content with no preview, no prompt, and (since cli.ts only prints the URL from inside `confirmUpdate`, L86 of cli.ts) **without ever showing where the content came from**. The user sees only `[mochi] Created .claude/skills/mochi/SKILL.md`. This is asserted as intended behaviour in `cli.test.ts` ("Nothing to review on a first write"), but the risk the prompt exists to manage is fully present on that path.
2. **The source URL is attacker-reachable through project data.** L63 takes `process.env.MOCHI_SKILL_URL` with no scheme or host restriction. `cli.js` is `#!/usr/bin/env bun`, and Bun auto-loads `.env` (plus `.env.development`/`.env.production`) from the cwd, so a value committed in a repository's env file — many projects gitignore only `.env` and `.env.local` — silently redirects the fetch. A contributor who clones such a repo and runs `bunx mochi-framework update-skill` installs attacker-authored instructions into their agent's skill directory, with no URL displayed and no confirmation on the first run. `http://` is accepted too, which reopens plaintext MITM on the download.
3. **No integrity check on the response.** L73-77 verify only `res.ok`, then `res.text()` is written verbatim. There is no checksum, signature, content-type or size check, and `fetch` follows redirects by default, so whoever controls the final response controls the instructions.

The payload is prompt injection against an agent holding tool access in the developer's repository, which is why I rate this above informational despite requiring the developer to run the command.

## Recommendation

Show the fetched body and confirm on the `created` path too (a first write is reviewable — print the content, not a diff against nothing). Echo the resolved source URL on every path, not only inside `confirmUpdate`. Require `https:` unless an explicit flag opts into an insecure scheme, and prefer a `--url` flag over an ambient env var so repo-resident `.env` data cannot silently retarget the fetch. Ideally publish a digest alongside the framework version and verify the body against it before writing.

## Revalidation

**Verdict:** true-positive

All three sub-claims check out against the code, the tests and the docs. (1) L86 reads `if (!created && confirmUpdate && !(await confirmUpdate(...)))`, so on a first write the callback is never invoked; cli.ts prints the source URL only *inside* `confirmUpdate` (L86), so the user sees nothing but `[mochi] Created .claude/skills/mochi/SKILL.md` — no content, no prompt, and no indication of where the bytes came from. cli.test.ts asserts `stdout` does *not* contain 'Skill update fetched' on a first write, and docs/183-cli.md states 'A first write is not prompted', so this is intentional — but intentional is not the same as safe, and the docs justify the gate precisely because 'The hosted SKILL.md is instructions your coding agent will follow', a risk that is *fully* present when the content is entirely new. (2) L63 takes `process.env.MOCHI_SKILL_URL` with no scheme or host check. I confirmed the bin is `src/cli/cli.js` with `#!/usr/bin/env bun`, and Bun's documented env loading reads `.env`, then `.env.{production,development,test}` by NODE_ENV, then `.env.local` from the cwd — and this repo's own `.gitignore` ignores `.env`, `.env.local` and the `*.local` variants but *not* `.env.development`/`.env.production`, which is exactly the committed-env-file gap described. `http://` is accepted. (3) L73-77 check only `res.ok`, then `res.text()` is written verbatim at L89 — no digest, signature, content-type or size check, and `fetch` follows redirects, so the final responder controls the instructions. The mitigation I weighed against this: anyone who can commit `.env.development` can usually commit `.claude/skills/mochi/SKILL.md` or `CLAUDE.md` directly, so the env-redirect adds little for a repo-write adversary. What survives that argument is the part needing no repo access at all — a compromise of mochi.fast, its DNS or a redirect hop installs agent instructions into every project that runs the command, with zero prompt on first write and a diff the operator may rubber-stamp afterwards. That is a genuine supply-chain weakness on a path the project's own threat model already lists, and MEDIUM is the right band for prompt injection into a tool-holding agent.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-07)
