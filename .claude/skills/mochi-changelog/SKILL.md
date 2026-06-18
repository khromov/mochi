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
- **No PR numbers or issue references in the bullets.** Each bullet is just the description — no trailing `(#74)`, no `#74`, no links.
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

   Use the `gh` output only to disambiguate commit subjects; do **not** carry PR numbers into the changelog.

3. Bucket the entries by Conventional Commits prefix:
   - `feat:` → **Features**
   - `fix:` / `perf:` + anything else user-facing (`refactor:` that drops deps, etc.) → **Fixes & misc**
   - drop pure non-user-facing noise.

   Omit any bucket that ends up empty.

4. Write `CHANGELOG-NEW.md` as a **release announcement** (this gets posted to Discord/GitHub). Use **simple, portable Markdown that renders identically on GitHub and Discord** — only `#`/`##` headings, `-` bullets, and `**bold**`. Format:

   ```md
   # ✨ Mochi <version> is out!

   To update, run `bun update --latest` in your repo.

   **Features**

   - short description

   **Fixes & misc**

   - short description
   ```

   - Lead with the `# ✨ Mochi <version> is out!` headline (use the new release version, not the diffed-against tag) — open with a cute emoji that fits the release — followed by the `bun update --latest` line.
   - Write bullets in a friendly announcement voice: lead with an active verb ("Add…", "Fix…", "Make…"), say what it does for the user, not just the commit subject. Collapse closely related commits into one bullet.
   - **Order items within each section by how cool/important they are** — lead with the headline features users will care about most, trail with the minor/internal ones. Don't preserve commit or chronological order.
   - Do **not** include PR numbers or issue references — bullets are description-only.
   - **Link each item to its docs page** using markdown links (`[`ViewTransitions`](https://mochi.fast/docs/view-transitions)`). Wrap the most relevant phrase, not the whole bullet. The docs base URL is `https://mochi.fast/docs/<slug>`, where `<slug>` is the docs filename in `packages/docs/` minus its numeric prefix and `.md` (e.g. `148-view-transitions.md` → `view-transitions`). Skip the link for items with no matching docs page (e.g. internal dependency removals).
   - **Add a `#`-anchor when the item is a sub-section of a shared page.** A whole-page link (`/docs/<slug>`) is right when the feature _is_ the page; when several items map to the same page, or the feature is one heading within a broader page, deep-link to that heading instead. To find the anchor:
     1. List the page's headings: `grep -n '^#' packages/docs/<file>.md`.
     2. Pick the heading that names the feature, then slugify it: lowercase, strip backticks/punctuation, replace spaces with `-` (e.g. `### Mochi.file` → `#mochifile`, `### HEAD requests` → `#head-requests`, `## Agent skill (recommended)` → `#agent-skill-recommended`, `### Unique ids with $props.id()` → `#unique-ids-with-propsid`). The final URL is `https://mochi.fast/docs/<slug>/#<anchor>`.
     - Don't guess anchors — always confirm the heading exists in the source file first. If no heading matches the feature, link the bare page.
   - Use `**bold**` group labels rather than `###` sub-headings so the spacing stays tight in Discord.

5. Report the tag you diffed against and the bullet count. Stop — don't push, commit, or edit the real changelog.

## Guardrails

- **Never edit `packages/mochi/CHANGELOG.md`** — that's release-please's file.
- If there are no commits since the tag, write a one-line `CHANGELOG-NEW.md` saying so and report it.
- Don't invent entries — every bullet must trace to a real commit or PR.
