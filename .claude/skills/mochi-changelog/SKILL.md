---
name: mochi-changelog
description: Generate a VERY BRIEF changelog of what has shipped since the last mochi-framework release tag, written to CHANGELOG-NEW.md. Use when the user says "generate a changelog", "what's changed since the last release", or "/mochi-changelog".
user-invocable: true
model: sonnet
---

# Generate a Mochi changelog

Produce a **very brief** changelog of everything merged since the last `mochi-framework` release, written to `CHANGELOG-NEW.md` at the repo root. This is a quick human-readable preview of the next release — **not** the release-please-generated `packages/mochi/CHANGELOG.md`, which you must never touch.

## Rules

- **Brevity is the whole point.** A handful of bullet points, grouped by type. No paragraphs, no per-commit dumps, no commit SHAs in the bullets.
- **Only count framework-relevant changes.** Releases are cut from `mochi-framework-v*` tags, so diff against the latest of those. Skip pure `chore:`/`ci:`/`test:`/`build:` noise unless it's user-facing.
- **Collapse related commits** into one bullet (e.g. several HMR fixes → "various HMR edge-case fixes").
- **Overwrite** `CHANGELOG-NEW.md` each run. Do not push or commit.

## Steps

1. Find the last release tag:

   ```sh
   git describe --tags --abbrev=0 --match 'mochi-framework-v*'
   ```

2. Gather what's merged since it. Run these in parallel:

   ```sh
   git log <tag>..HEAD --no-merges --pretty='%s'
   gh pr list --state merged --base main --limit 50 --json number,title,mergedAt
   ```

   Use the `gh` output to attach PR numbers where a commit maps to one; fall back to git subjects alone if `gh` is unavailable.

3. Bucket the entries by Conventional Commits prefix:
   - `feat:` → **Features**
   - `fix:` / `perf:` → **Bug Fixes**
   - everything else (`docs:`, `refactor:`, etc.) → drop unless clearly user-facing, then **Other**.

   Omit any bucket that ends up empty.

4. Write `CHANGELOG-NEW.md`. Read the most recent entry in `packages/mochi/CHANGELOG.md` first to match tone, but keep this terser. Use **simple, portable Markdown that renders identically on GitHub and Discord** — only `#`/`##` headings, `-` bullets, and `**bold**`. Format:

   ```md
   # Unreleased (since <tag>)

   **Features**

   - short description (#74)

   **Bug Fixes**

   - short description
   ```

   - Reference PRs as bare `#74` (GitHub auto-links these; Discord shows them as plain text). Do **not** use masked `[text](url)` links — Discord renders them inconsistently. If a full URL is genuinely useful, paste it raw.
   - Use `**bold**` group labels rather than `###` sub-headings so the spacing stays tight in Discord.

5. Report the tag you diffed against and the bullet count. Stop — don't push, commit, or edit the real changelog.

## Guardrails

- **Never edit `packages/mochi/CHANGELOG.md`** — that's release-please's file.
- If there are no commits since the tag, write a one-line `CHANGELOG-NEW.md` saying so and report it.
- Don't invent entries — every bullet must trace to a real commit or PR.
