# STE writing rules — full catalog

Derived from ASD-STE100 (Simplified Technical English), Issue 9, translated for
programming documentation. The `SKILL.md` core rules cover the common cases;
consult this file for edge cases and the complete rule set.

Everything here is the transferable principle only. Aviation examples are dropped.

---

## Words & naming

- **Use an agreed vocabulary.** Draw names, logs, and prose from a known set of
  terms plus a small set of approved action verbs (get, set, create, delete,
  validate, …). A new term needs a documented reason.
- **One part of speech per word.** Nouns name entities/types/variables; verbs
  name functions/methods. Don't let one word switch roles.
- **One restricted meaning per word.** If `flush` means "write buffered data to
  disk", never reuse it for "clear a cache". Avoid polysemous names and log terms.
- **Domain terms are allowed** (class names, protocol terms, schema fields) if
  they come from an agreed vocabulary, not invented ad hoc per file.
- **Don't verb a noun-only term.** "store the object in the cache", not "cache
  the object" — unless "cache" is also defined as a verb.
- **Don't nominalize a verb** ("parse the file", not "give the file a parse").
  Past-participle adjectives are fine ("the parsed output", "a validated request").
- **Reuse the established term** ("token", not a new synonym "ticket").
- **Prefer short, clear names.** Let scope, type, and namespace carry the
  disambiguating context instead of piling adjectives into the identifier.
- **No slang, memes, or insider jargon** in public identifiers, messages, or docs.
- **Never use two names for one item.** `userId` / `user_id` / `accountId` for
  one field is the classic violation. Unify.
- **One spelling convention** throughout (e.g. American English). Keep original
  spelling only when quoting a third-party API's literal string.
- **Cap compound identifiers at ~3 stacked modifiers.** Longer chains hide the
  head noun; break them apart with structure (namespaces, nested objects).
- **Long official terms:** spell out in full at first use, then define a short
  alias/acronym ("Continuous Integration (CI)") and use it consistently. Don't
  drown text in unexplained acronyms.

## Verbs, tense & voice

- **Keep a canonical verb set** (and exact forms) for commit messages, method
  names, and CLI subcommands. No delete/del/remove/rm variants for one action.
- **Simple tenses only** — no perfect or progressive:
  - Imperative for commit subjects and instructions: "Fix null check" (not
    "Fixed", "Fixes", "Has fixed").
  - Simple present to describe behavior: "Returns the parsed value".
  - Avoid "has been deprecated" / "is being processed" → "is deprecated" /
    "processes".
- **Past participle only as a state adjective:** `isValidated`, "Connection
  closed". Not as a passive verb phrase.
- **No auxiliary-verb chains.** "The scheduler retries the job", not "The job
  can be retried by the scheduler".
- **"-ing" only as a noun or compound modifier** (headings: "Logging",
  "Troubleshooting"; "caching layer"). Never a present participle in
  instructions ("While the system loads the file, wait", not "While the file is
  loading, wait").
- **Active voice with a clear subject.** Name the actor/cause in error messages
  when known ("Validator rejected the request because X"). Passive is allowed
  only when the cause is genuinely unknown ("The connection was reset").
  Four fixes: (1) promote the known agent to subject; (2) replace "is used to X"
  with the direct verb; (3) use the imperative in procedures ("Continue the
  test"); (4) use "you" (user-facing) or "we" (the tool's own actions) when no
  agent is named.
- **Prefer a direct verb over a nominalization.** "Remove the unit", not "Do the
  removal of the unit". "The sensor detects motion", not "gives an indication of
  motion".

## Sentences

- **Short and single-idea.** ~20 words for instructions, ~25 for descriptions.
- **Vertical lists for anything complex.** End the lead-in with a colon. Keep
  every item grammatically parallel (all imperative OR all noun phrases). Don't
  mix procedural and descriptive items. Keep items at one level; nest sparingly.
  For warning lists, repeat "Do not" on EACH line so each reads correctly alone.
- **Use connecting words** ("then", "as a result", "however") to link short
  sentences instead of one long compound sentence.
- **Don't drop articles** when it creates ambiguity ("open the file"). But treat
  identifiers/config keys as proper nouns with no article ("Set FEATURE_FLAG_X").

## Procedural / instructional text (runbooks, install steps, CLI help)

- Max ~20 words per instruction sentence (~25 for notes).
- **One instruction per step.** Only truly atomic actions share a sentence
  ("acquire and release the lock").
- **Imperative mood.** Reserve emphatic "must"/"required" for genuinely critical
  steps (data loss, security) so it keeps its impact.
- **Condition before command.** "If the cache is stale, run `make clean`". Watch
  comma placement — it changes meaning.
- **A "Note:" gives information only** — never a hidden instruction, requirement,
  limit, or result. Test: the procedure must still work if every Note is deleted.
  If removing a note breaks correctness, promote its content into a real step,
  signature, validation, or warning.

## Descriptive text (README prose, architecture docs, long docstrings)

- **Give information gradually** — one subject per sentence.
- **Repeat the same key term** (not a synonym) across sentences. "Elegant
  variation" is the prose form of inconsistent naming.
- Max ~25 words per descriptive sentence.
- **Start each paragraph/section with a topic sentence.** A reader should get
  the outline from just the first sentence of each paragraph.
- **One topic per paragraph.** Don't blend "how to install" with "how it works".
- Max ~6 sentences per paragraph; longer is a signal to split into a section or
  list.

## Warnings & severity (log levels, error messages, destructive prompts)

- **Explicit, honest severity marker** (ERROR / WARNING / FATAL, "Danger:").
  Data-loss and security operations get the highest marker. Don't bury them as
  "info"; don't downgrade to avoid alarming the reader.
- **Lead with the actionable command or condition**, not backstory.
- **State the concrete consequence.** "This permanently deletes 3 tables and
  cannot be undone", not "proceed with caution".

## Punctuation & mechanics

- **Avoid the semicolon** — two short sentences instead.
- **Hyphens for compound modifiers**: "zero-downtime deploy", "read-only mode",
  "off-by-one error".
- **Parentheses only for defined jobs**: define an abbreviation on first use, a
  brief clarification, or an either/or alternative. Never hide essential
  information (a required parameter or a risk) inside a parenthetical.
- When enforcing a length limit, treat an atomic token (a long URL or
  identifier) as a single unit rather than letting it blow the guideline.

## General recommendations

- **Keep "that"** after ensure/show/confirm/verify ("Make sure that the file
  exists") — marks the clause boundary and aids translation.
- **Watch ambiguous connectors** ("with", "as", "for"). Lead with the real verb:
  "Seal the opening with tool X", not "Use tool X to seal the opening".
- **Pronoun only when the referent is unambiguous.** With several nouns in scope,
  repeat the noun.
- **A dangling "this" must have one clear antecedent.** Restate the referent.
- **Watch "false friends"** from non-native authors ("actual" = "current",
  "eventually" = "possibly"). Flag in review for international contributors.
- **Avoid Latin abbreviations.** "for example", not "e.g."; drop a vague "etc."
  and state the rule or a complete list.
- **Inclusive, gender-neutral language.** Avoid "he" for a generic user; avoid
  loaded terms (master/slave, whitelist/blacklist) where neutral alternatives
  exist.
- **Prefer an "of" construction** over an ambiguous possessive for a global
  audience ("the configuration of the server").

## Controlled-vocabulary method

- A vocabulary is a **finite, closed set** — keep an explicit approved-terms list
  (GLOSSARY.md / linter dictionary), don't let it grow per-author.
- **Word selection is a repeatable procedure**, not taste: check the glossary
  first; use the canonical term exactly; if none exists, extend the glossary via
  review or restructure — never silently invent a synonym.
- **Modals collapse to a fixed, small set** of certainty levels: MUST
  (obligation) and CAN (possibility). This is exactly RFC 2119 (MUST/REQUIRED vs
  MAY/OPTIONAL). Don't write "this should probably not happen".
- **A closed verb set** models Conventional Commits (add/fix/remove/update/
  refactor) and REST/RPC vocabularies (create/get/list/update/delete/cancel — not
  handle/process/doThing). Fix the exact tense/mood per category and document it.
- **No antonym is auto-derived:** approving `enable()` doesn't make `disable()`
  "obviously fine". Vet negation/double-negation naming — a classic bug source.
