---
name: ste-docs
description: >-
  Write new or rewrite existing programming documentation in the style and tone
  of ASD-STE100 Simplified Technical English — short single-idea sentences, one
  concept per word, active voice, imperative instructions, a controlled
  vocabulary, and consistent terminology. Use when creating or editing READMEs,
  docstrings, code comments, guides, tutorials, runbooks, changelogs, release
  notes, CONTRIBUTING files, CLI help, or error/log/warning message text — or
  whenever asked to make documentation clearer, simpler, plainer, more
  consistent, or easier to read for a global / non-native-English audience.
---

# Simplified Technical English for programming docs

Apply the writing discipline of ASD-STE100 (Simplified Technical English) to
software documentation. The goal is text that a non-native English reader, a
translator, or an AI tool cannot misread: short sentences, one idea each, plain
words, active voice, and one name per concept.

This skill covers prose written *by and for developers*: READMEs, docstrings,
code comments, guides, runbooks, changelogs, CLI help, and error/log/warning
messages. It does not change code logic or identifiers already fixed by an API
— only the documentation and message text around them.

## The core rules (apply every time)

These are non-negotiable. Follow all of them in every sentence you write.

1. **One idea per sentence.** Max ~20 words for an instruction, ~25 for a
   description. Split anything longer. Avoid semicolons — use two sentences.
2. **One concept, one word.** Pick a single canonical term per concept and
   reuse it everywhere. Never vary vocabulary for elegance
   (get/fetch/retrieve, user/account/customer → choose one).
3. **Active voice, clear subject.** "The parser rejects bad input", not "Bad
   input is rejected". Use passive only when the actor is genuinely unknown.
4. **Imperative for instructions.** "Run the tests", not "Tests can be run" or
   "You should run the tests". One action per numbered step.
5. **Simple tense.** Imperative for commands, simple present to describe
   behavior ("Returns the value"). No perfect/progressive ("has been
   processed", "is being loaded").
6. **Plain, short words.** Prefer the common word over the long Latinate one
   (use, not utilize; start, not commence; make sure, not verify). See the
   word list.
7. **Concrete over vague.** Replace fuzzy words with a value, bound, or
   explicit condition ("retry after 30s", not "retry periodically"; "if X
   fails", not "in the event of failure").
8. **Condition before command.** "If the cache is stale, run `make clean`" —
   front-load context so the reader does not act too early.
9. **Warnings first, with the consequence.** Put the warning before the
   dangerous step and state what happens: "This permanently deletes the table
   and cannot be undone."
10. **Lists over long prose.** Use a bullet or numbered list for anything with
    multiple items or steps. Keep list items grammatically parallel.

## Workflow — writing NEW documentation

1. **Confirm the audience and doc type** (README, runbook, error message,
   docstring, …). Instruction text is imperative; description text is simple
   present.
2. **Draft the structure first.** One topic per section. Each paragraph or
   section opens with a topic sentence and holds one topic (max ~6 sentences).
3. **Write each sentence to the core rules above.** One idea, active, short,
   plain words, consistent terms.
4. **Build the term list as you go.** The first time you name a concept, that
   is its canonical name — reuse it exactly for the rest of the document.
5. **Run the self-check** (below) before finishing.

## Workflow — REWRITING existing documentation

1. **Read the whole document first.** Note its purpose, audience, and the
   canonical name it should use for each concept.
2. **Preserve meaning exactly.** Never drop a fact, constraint, warning, or
   step. If a "Note:" hides a required step or limit, promote it into a real
   step, parameter constraint, or warning — do not leave it as an aside.
3. **Rewrite sentence by sentence** against the core rules. When a plain-word
   swap would break the sentence, restructure the whole sentence instead of
   forcing an awkward word (this is the STE rule 9.1 — never emit garbled text
   just to use a simpler word).
4. **Unify terminology across the whole file.** Find every synonym for one
   concept and collapse them to a single term. Fix inconsistent spelling
   (color/colour, initialize/initialise) to one convention.
5. **Apply the word substitutions** from `references/word-substitutions.md`.
6. **Keep code, identifiers, and quoted API strings verbatim.** Only change
   the prose around them. Treat identifiers and config keys as proper nouns
   (no article: "Set FEATURE_FLAG_X", not "Set the FEATURE_FLAG_X").
7. **Show what changed** if the user is reviewing — summarize the main kinds
   of edits (shortened sentences, unified terms, active voice, word swaps).

## Reference files (load when you need them)

- **`references/word-substitutions.md`** — the "avoid → prefer" word list
  (utilize→use, prior to→before, exceed→more than N, "not X" over fused
  negatives, de-prefixing "re-", modal discipline). Consult it whenever you
  simplify vocabulary. It is a lookup table, not a thing to read end to end.
- **`references/writing-rules.md`** — the full rule catalog (words & naming,
  verbs/tense/voice, sentences, procedural text, descriptive text, warnings,
  punctuation, general recommendations). Consult it for edge cases the core
  rules above do not settle.
- **`references/review-checklist.md`** — a pass/fail checklist. Run it as the
  final self-check on any document you write or rewrite.

## Self-check before finishing

Run through `references/review-checklist.md`. At minimum confirm:

- No sentence over ~20–25 words; no semicolons; one idea each.
- Every concept uses exactly one term throughout.
- Instructions are imperative; descriptions are simple present; voice is active.
- No vague qualifier that could be a concrete value or condition.
- No Latin abbreviations (e.g., i.e., etc.); no idioms or slang.
- Warnings precede the dangerous step and state the consequence.
- Meaning is unchanged from the source (for rewrites) — nothing dropped.

## Scope note

This skill governs documentation *tone and clarity*. It does not decide
formatting mechanics (indentation, Markdown flavor, line-length config) or
rename code identifiers — keep those to the project's existing style and lint
config. If a term is a fixed external API field or error string, keep it
exactly as-is even if it breaks a rule.
