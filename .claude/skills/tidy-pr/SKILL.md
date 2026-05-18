---
name: tidy-pr
description: Review and tidy a pull request — strip noise (debug logs, throwaway comments), assess the diff for clarity and minimalism with junior readers in mind, and refactor sub-optimal sections after weighing up to three alternatives. Use when the user asks to "tidy this PR", "clean up the branch before merge", "review and polish the diff", or similar.
user-invocable: true
---

# Tidy a PR

Polish the pending changes on the current branch (or a specified PR) so the diff is clean, minimal, and easy for a junior developer to follow. Make edits in place — do not produce a separate report.

## Scope

Operate only on lines that are **added or modified** in the diff. Do not touch unrelated code, even if you spot improvements; flag those at the end so the user can decide.

If a `<PR#>` argument is supplied, check it out first (`gh pr checkout <PR#>`). Otherwise work on the current branch against `main`.

## Steps

### 1. Survey the diff

```sh
git diff --stat main...HEAD
git diff main...HEAD
git status
```

Build a mental list of every changed file and what each change is trying to accomplish. If the intent is unclear from the diff alone, read the surrounding code (not just the hunks) before judging anything.

### 2. Strip noise

For each changed file, remove:

- **Debug logs** — `console.log`/`console.debug`/`print`/`dbg!` left over from development. Keep logs that are clearly intentional observability (structured logger calls, error reports, the project's `log.*` wrapper).
- **Commented-out code** — dead code parked behind `//` or `/* */`. If a reviewer would ask "why is this commented out?", delete it.
- **Throwaway comments** — comments that restate the code (`// increment counter`), narrate the task (`// added for the X feature`, `// fix from issue #123`), or mark removed code (`// removed Foo`). Keep comments that explain non-obvious _why_: a hidden constraint, a workaround, a surprising invariant.
- **TODO/FIXME stubs** added in this PR with no follow-up — either resolve them or surface them to the user.
- **Unused imports, variables, parameters** introduced by the PR. Use the project's typecheck/lint to confirm before deleting.
- **Stray `.only` / `.skip`** in tests and any scratch files (`tmp.ts`, `scratch/`, `IMPROVEMENTS.md`-style notes) committed by accident.

### 3. Assess each change for clarity and minimalism

Read every non-trivial added block and ask:

- **Is it the smallest change that solves the problem?** Extra abstractions, helpers introduced for a single caller, premature generalization — flag for refactor.
- **Would a junior developer understand this on first read?** Watch for clever one-liners, deeply nested ternaries, point-free chains, or names that require domain knowledge the code doesn't supply.
- **Are names accurate?** A function called `validate` that also mutates is mis-named. Rename instead of commenting around it.
- **Does the structure match the rest of the codebase?** A new pattern that diverges from neighbours costs the reader extra context. Match existing conventions unless there's a clear reason not to.
- **Is error handling load-bearing or ceremonial?** Fallbacks for impossible states, try/catch that re-throws unchanged, validation of trusted internal inputs — strip them.

### 4. Refactor sub-optimal sections

When a block fails step 3, do **not** just rewrite it the first way that comes to mind. Instead:

1. **Sketch up to three alternative approaches** in your head (or briefly in your reply). Examples of axes to vary: data structure, control flow (early return vs nested if vs lookup table), where the logic lives (caller vs callee, util vs inline), sync vs async, imperative vs declarative.
2. **Score each** against: lines of code, cognitive load for a junior, alignment with existing patterns, performance if relevant.
3. **Pick the winner and apply it.** If two are tied, prefer the one that adds the least new vocabulary to the file.
4. If none are clearly better than the original, leave it alone — churn for its own sake is not tidying.

Only spend the three-alternative budget on blocks that genuinely warrant it. Trivial cleanups (delete a log, rename a variable) don't need a deliberation.

### 5. Verify

Run the project's checks before finishing:

```sh
bun run typecheck
bun run lint
bun run test
bun run format
```

(Substitute the project's actual commands if different — check `package.json` scripts or `CLAUDE.md`.) Fix any failures introduced by the tidy pass. If a check was already failing before you started, say so rather than silently "fixing" unrelated issues.

### 6. Report

End with a short summary:

- **Removed:** bullet list of noise stripped (file:line where useful).
- **Refactored:** bullet list of blocks rewritten, with a one-line rationale each (which alternative won and why).
- **Left alone but worth a look:** anything outside the diff scope, or judgement calls you didn't want to make unilaterally.

Keep the report under ~20 lines. The diff is the source of truth; the summary is a pointer.

## Guardrails

- **Don't change behaviour.** Tidying is a no-op semantically. If a refactor would alter observable behaviour (different error message, different return shape, different ordering), call it out and ask before applying.
- **Don't reformat unrelated lines.** Prettier/eslint --fix on the whole repo will balloon the diff. Run formatters only on files you actually edited.
- **Don't squash or rewrite history** unless explicitly asked. Stage the tidy as a normal commit on top.
- **Don't push or open/update the PR** without confirmation.
