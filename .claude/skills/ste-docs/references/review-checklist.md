# STE review checklist

Run this as the final self-check on any document you write or rewrite. Each item
is pass/fail. Fix every failure before finishing.

## Sentences & structure

- [ ] No instruction sentence over ~20 words; no description over ~25 words.
- [ ] One idea per sentence. No semicolons.
- [ ] Each paragraph/section opens with a topic sentence and holds one topic.
- [ ] No paragraph over ~6 sentences.
- [ ] Multi-item or multi-step content is a bullet/numbered list, not prose.
- [ ] List items are grammatically parallel (all imperative OR all noun phrases).

## Words & terminology

- [ ] Every concept uses exactly ONE term throughout the document.
- [ ] Spelling convention is consistent (color/colour, initialize/initialise).
- [ ] No slang, memes, idioms, or insider jargon.
- [ ] No Latin abbreviations (e.g., i.e., etc.).
- [ ] Long/Latinate words replaced with plain ones (see word-substitutions.md).
- [ ] Compound identifiers referenced in prose are not over ~3 stacked modifiers.
- [ ] Acronyms are spelled out on first use, then used consistently.

## Verbs, tense & voice

- [ ] Instructions are imperative ("Run the tests").
- [ ] Descriptions are simple present ("Returns the value").
- [ ] No perfect or progressive tense ("has been processed", "is being loaded").
- [ ] Active voice, with a clear subject; passive only when the cause is unknown.
- [ ] Modals reduced to MUST (obligation) or CAN (possibility).

## Precision

- [ ] No vague qualifier that could be a concrete value, bound, or condition.
- [ ] Time/order words are precise ("then"/"next", not "eventually"/"subsequent").
- [ ] Pronouns ("it", "this", "they") have one unambiguous referent.
- [ ] Conditions come before commands ("If X, do Y").

## Instructions & notes

- [ ] One action per step.
- [ ] No "Note:" hides a required step, constraint, limit, or result. (Test: the
      procedure still works if every Note is deleted.)

## Warnings & safety

- [ ] Warnings come before the dangerous step.
- [ ] Each warning states the concrete consequence, not just "be careful".
- [ ] Severity markers (ERROR/WARNING/FATAL) match the real consequence.

## Fidelity (rewrites only)

- [ ] Meaning is unchanged — no fact, constraint, warning, or step dropped.
- [ ] Code, identifiers, and quoted API/error strings are kept verbatim.
- [ ] Any awkward plain-word swap was fixed by restructuring the sentence, not by
      forcing the word.

## Inclusivity

- [ ] Gender-neutral language; no loaded terms where neutral ones exist.
