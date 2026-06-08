---
name: add-feature
description: Add a missing entry to the release-please changelog via an empty conventional commit. Use when the user says "add feature", "add fix to changelog", "add to release", or "/add-feature <description>".
user-invocable: true
model: sonnet
---

# Add a missing changelog entry via release-please

Use `git commit --allow-empty` to retroactively add an entry to the pending release-please changelog — for work that was already merged under a non-conventional or wrong commit type.

## Monorepo scoping

This is a monorepo with multiple release-please packages. Empty commits have no changed files, so release-please can't use path-based filtering. You **must** include a scope matching the package's component name to target the right changelog:

- `mochi-framework` → `fix(mochi-framework): description`
- `create-mochi` → `fix(create-mochi): description`

Default to `mochi-framework` if the user doesn't specify a package.

## Rules

- **Never push.** Just commit locally.
- **Title only** — no commit body.
- **Title must be a valid scoped Conventional Commit:** `feat(mochi-framework):`, `fix(create-mochi):`, etc. Use `feat!` only if the user explicitly says it's breaking.
- **Keep it short** — under 72 characters, present tense, lowercase after the colon, no trailing period.

## Steps

1. Read the description and type from the skill args. Default type to `feat` if unspecified. Default package to `mochi-framework` if unspecified.
2. Draft the one-line scoped conventional commit message and show it to the user for confirmation.
3. Run: `git commit --allow-empty -m "<type>(<package>): <description>"`
4. Report the resulting short SHA and title. Remind the user to push to `main` so release-please picks it up.
