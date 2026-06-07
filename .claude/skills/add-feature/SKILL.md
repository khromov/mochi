---
name: add-feature
description: Add a missing entry to the release-please changelog via an empty conventional commit. Use when the user says "add feature", "add fix to changelog", "add to release", or "/add-feature <description>".
user-invocable: true
model: sonnet
---

# Add a missing changelog entry via release-please

Use `git commit --allow-empty` to retroactively add an entry to the pending release-please changelog — for work that was already merged under a non-conventional or wrong commit type.

## Rules

- **Never push.** Just commit locally.
- **Title only** — no commit body.
- **Title must be a valid Conventional Commit:** `feat:`, `fix:`, `perf:`, `docs:`, `refactor:`, etc. Use `feat!:` only if the user explicitly says it's breaking.
- **Keep it short** — under 60 characters, present tense, lowercase after the colon, no trailing period.

## Steps

1. Ask the user (or read from the skill args) what the entry should describe and which type it is (`feat`, `fix`, etc.). Default to `feat` if unspecified.
2. Draft the one-line conventional commit message and show it to the user for confirmation.
3. Run: `git commit --allow-empty -m "<type>: <description>"`
4. Report the resulting short SHA and title. Remind the user to push to `main` so release-please picks it up.
