# [BUG] Three of four prompts lack the non-TTY guard that `promptToggle` documents as necessary

**File:** [`packages/cli/src/cli.ts`](https://github.com/khromov/mochi/blob/main/packages/cli/src/cli.ts#L129-L166) (lines 129, 135, 139, 166)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

promptToggle guards non-interactive environments explicitly — `if (!process.stdin.isTTY) { return true; }` with the comment 'No terminal to ask (CI, piped stdin) — take the default rather than hanging on the prompt' (L150-152). By the codebase's own stated knowledge that clack prompts hang without a TTY, the other three prompt helpers are defective: `maybePromptForce` (L135, reached whenever the target directory is non-empty and `--force` was not passed), `promptDirectory` (L109, reached when no `[path]` argument is given), and `promptTemplate` (L166, reached when `--template` is omitted) all call into clack unguarded. A scripted invocation — a Dockerfile, a CI step, `npm create mochi` with piped stdin — therefore hangs forever instead of failing fast. The project's own regression harness never exercises this because `.github/scripts/cli-regression-test.ts:255` always passes a path plus `--template` and `--force`. A related smaller issue: cancellation in all three helpers calls `process.exit(0)`, so a scripted run that cancels or declines the overwrite reports success to the caller despite having scaffolded nothing.

## Recommendation

Extract the `!process.stdin.isTTY` check into a shared helper and apply it in `promptDirectory`, `maybePromptForce`, and `promptTemplate` — in non-interactive mode, take the documented default (`./my-mochi-app`, `minimal`) and, for the overwrite prompt, throw a clear 'directory is not empty; pass --force' error rather than prompting. Change the cancellation exits in these helpers to `process.exit(1)` so callers can detect that nothing was scaffolded.

## Revalidation

**Verdict:** true-positive

I verified the asymmetry in the source and the hang in the dependency. `promptToggle` (cli.ts:146-160) returns the default when `!process.stdin.isTTY`, with a comment stating the reason; `promptDirectory` (105-125), `maybePromptForce` (127-144) and `promptTemplate` (162-176) call `p.text`/`p.confirm`/`p.select` with no such guard. In the installed `@clack/core@1.6.0`, `Prompt.prototype.prompt()` returns a Promise that is settled only by `this.once('submit')` / `this.once('cancel')` (plus an optional abort signal), and those states are reachable only from `onKeypress`; there is no handler for stdin `end`/`close`, so with a non-TTY stdin the call either blocks forever (an open pipe that never delivers a keypress) or the process drains the loop and exits silently having scaffolded nothing. The triggering conditions are exactly as described: no `[path]` argument, a non-empty target directory without `--force`, or no `--template`. The claim that CI never catches this is also right — .github/scripts/cli-regression-test.ts always spawns `bun create mochi@latest <dir> --template <t> --force`; notably it does *not* always pass `--eslint`/`--prettier`, which is why `promptToggle` needed its guard in the first place, strong evidence the non-TTY path is hit in practice. The secondary point is accurate too: all three helpers `process.exit(0)` on cancel/decline, so a scripted caller sees success after scaffolding nothing. This is a correctness/UX defect rather than a security issue, so BUG is the right severity.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-22)
