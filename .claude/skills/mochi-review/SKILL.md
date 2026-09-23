---
name: mochi-review
description: Review the current branch's changes (or a specific PR). Use when the user asks to "review my branch", "review this", "review PR <number>", or "/mochi-review [number]". Always consumes the entire diff into context, then produces a thorough, concise code review.
---

Review a change to the Mochi monorepo. The conventions to check against live in the root `CLAUDE.md` — read it first.

1. Determine the target:
   - If a PR number is provided in the args, review that PR. Run `gh pr view <number> --json title,body,author,baseRefName,headRefName,state,additions,deletions,changedFiles,labels` for details.
   - Otherwise, review the **current branch by default**. Run `git rev-parse --abbrev-ref HEAD` to confirm the branch, and `git log --oneline main..HEAD` (or against the appropriate base) plus `git diff --stat main...HEAD` to understand its scope.

2. Read the **entire** diff:
   - For a PR: `gh pr diff <number>`.
   - For the current branch: `git diff main...HEAD` (use the actual base branch if not `main`).
   - Read every changed line before reviewing, because a finding about code you haven't loaded is a guess. If the diff is too large for one tool output, page through it by file (`git diff main...HEAD -- <path>`, using `--stat` to enumerate files).

3. Write the review: a short overview of what the change does, then findings ordered by severity, each with `file:line` and a concrete fix. Correctness and regressions come first; convention violations from `CLAUDE.md` next. In this repo, weigh compatibility of the `demos`/`minimal` templates with the last published release, Windows path handling, and the release-please commit type. Omit a section when there is nothing to say in it.

Target (PR number or empty for current branch): $ARGUMENTS
