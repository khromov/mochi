# [MEDIUM] Concurrency group derived from attacker-controlled `github.head_ref` can cancel in-progress main-branch CI

**File:** [`.github/workflows/test.yml`](https://github.com/khromov/mochi/blob/main/.github/workflows/test.yml#L12-L14) (lines 12, 13, 14)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-ci-dos`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The concurrency group is `${{ github.workflow }}-${{ github.head_ref || github.ref }}` with `cancel-in-progress: true`. For a `pull_request` run, `github.head_ref` is the raw, unsanitized head branch name chosen by the PR author; for the `push` trigger the same slot is filled by `github.ref`, which is the fully-qualified `refs/heads/main`. Git permits slashes in branch names, so a fork PR opened from a branch literally named `refs/heads/main` yields `head_ref == 'refs/heads/main'` and therefore the group `test-refs/heads/main` — byte-identical to the group used by push-to-main runs. Because the newer run cancels the older one, any outside contributor can repeatedly push to such a PR to cancel the `test` run for main on demand, with no write access and no secrets required. Impact is denial of service against CI and loss of post-merge signal on main (a cancelled run is not reported as success, so it cannot be used to sneak a failing change past a required check). The same pattern exists in format.yml and review.yml.

## Recommendation

Namespace the group by event so PR runs can never share a group with branch runs, e.g. `group: ${{ github.workflow }}-${{ github.event_name }}-${{ github.head_ref || github.ref }}`, or use `${{ github.event.pull_request.number || github.ref }}` so the PR identity is a non-forgeable integer.

## Revalidation

**Verdict:** true-positive

Confirmed at test.yml:12-14: `group: ${{ github.workflow }}-${{ github.head_ref || github.ref }}` with `cancel-in-progress: true`. `github.head_ref` is the bare head branch name from `pull_request.head.ref` (no owner, no PR number), while a push to main fills the same slot with the fully-qualified `refs/heads/main`. I verified in a scratch repo that git accepts a branch literally named `refs/heads/main` — `git branch 'refs/heads/main'` succeeded, creating `refs/heads/refs/heads/main`, and `git check-ref-format --branch 'refs/heads/main'` exits 0 — so such a PR yields `head_ref == 'refs/heads/main'` and the group `test-refs/heads/main`, byte-identical to the push-to-main group, letting an outside contributor cancel main's test run on demand. The defect is actually broader than described: because the group carries no event, repository or PR discriminator, two PRs from different forks whose head branches merely share a name collide — and GitHub's web editor names branches `patch-1`, `patch-2`, so same-name collisions happen in ordinary use with no attacker at all. Impact is correctly bounded to availability: a cancelled run reports as cancelled, never success, so this cannot be used to slip a failing change past the required `test` check, and fork-PR workflow-approval gating may require the attacker to be a past contributor. I verified the identical pattern in format.yml:13 and review.yml:10 as the finding states. MEDIUM is appropriate for a reachable CI denial-of-service that also misfires on legitimate traffic.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-09)
