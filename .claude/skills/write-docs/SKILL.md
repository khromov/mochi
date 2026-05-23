---
name: write-docs
description: Author or revise a docs page in `packages/docs/` in the project's terse, code-first, Svelte-idiomatic style. Use when the user says "write docs for X", "document X", "/write-docs <topic>", or asks to revise an existing page in that folder.
user-invocable: true
---

# Write a docs page

Target is `packages/docs/<NN>-<slug>.md`. Audience is a developer skimming for how something works. Voice mimics Svelte's official docs: short prose, one realistic example up front, tables for reference data, minimal heading nesting.

## Style rules

- **Frontmatter is mandatory:** `title` (in single quotes, Title Case) and `slug` (kebab-case, matches filename minus the numeric prefix).
- **One H2 only**, matching the title. Add H3s only when the page genuinely has sub-sections — most pages don't (see `40-defining-routes.md`).
- **Lead with code.** First or second paragraph ends with a fenced block showing realistic, runnable usage. No toy `foo`/`bar` examples — use real names from the codebase.
- **Prose paragraphs are 1–3 sentences.** If one runs longer, split it or delete it.
- **Tables for reference data** (scripts, options, fields) — never a bulleted list. See `30-scripts.md`.
- **No marketing voice, no narrative buildup.** State what the thing is, then show it.
- **Cross-link with `[text](slug)`** — bare slug, no extension, no path. That's how existing pages link.
- **No "do/don't" callouts in the body.** Mochi docs don't use them; stay consistent.
- **Code samples use real project APIs.** Import paths like `mochi-framework`, real route shapes, real symbol names. Never invent APIs — verify against `packages/mochi/src/` first.
- **Svelte 5 only.** `$state`, `$props`, `$derived`, `onclick={...}` — never `export let`, `on:click`, or `$:`.

## Picking the filename

- The numeric prefix groups pages by section. Read existing filenames in `packages/docs/` first to find the right neighbourhood (routing → 40s, hydration → 80s, errors → 130s, etc.).
- Use the next free number ending in 5 (`45-…`) to slot between existing pages without renumbering. Only renumber a whole block if the user asks.
- Slug = filename minus the numeric prefix and `.md`. Frontmatter `slug` must match.

## Steps

1. **Identify the target.** If args name a topic, propose `<NN>-<slug>.md` and a title. If args reference an existing file, read it before editing.
2. **Read 2–3 nearby pages** in `packages/docs/` to absorb tone, length, and any cross-links you should reuse. The style is enforced by example, not by config — don't skip this.
3. **Verify the API.** Read the relevant source under `packages/mochi/src/` so symbol names, import paths, and option shapes are real. If the API doesn't exist yet or is mid-refactor, ask the user before writing.
4. **Draft the page.** Follow the style rules. Aim to fit on one screen (≤ ~60 lines) unless the topic genuinely needs more.
5. **Format.** Run `bun run format` on the file (CLAUDE.md requires this after any change).
6. **Report.** Print the path written and a one-line summary of what the page covers. Don't paste the full page back.

## Guardrails

- Don't edit unrelated docs in the same pass.
- Don't add a top-level `README.md`, `CONTRIBUTING.md`, or similar unless explicitly asked — `packages/mochi/README.md` deliberately defers to `docs/`.
- Don't invent APIs. If you can't find the symbol in `packages/mochi/src/`, stop and ask.
- Per-icon imports only in code samples (`import Sun from '@lucide/svelte/icons/sun'`), never barrel imports.
- Don't renumber existing files unless the user asks.
