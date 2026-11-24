# [MEDIUM] `COPY . .` bakes the project's `.env` (MOCHI_KEY and all other secrets) into the image because the shipped `.dockerignore` omits `.env*`

**File:** [`packages/minimal/Dockerfile`](https://github.com/khromov/mochi/blob/main/packages/minimal/Dockerfile#L8-L4) (lines 8, 4)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `secrets-exposure`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

This Dockerfile is a `create-mochi` template source, not just a local build file: it is git-tracked and `packages/cli/src/templates.ts` points the `minimal` template at `khromov/mochi/packages/minimal`, so `extractTemplate()` in `packages/cli/src/download.ts` copies both this `Dockerfile` and `packages/minimal/.dockerignore` verbatim into every scaffolded project (confirmed by `download.test.ts:59`, which asserts dotfiles are extracted).

Line 8 is an unrestricted `COPY . .`. The build-context filter is `packages/minimal/.dockerignore`, whose entire contents are `node_modules`, `.git`, `.mochi`, `Dockerfile`, `.dockerignore`, `*.log` — there is **no `.env*` entry**. Meanwhile the framework's own key-generation CLI writes the master secret straight into that file: `packages/mochi/src/cli/generateKey.ts` resolves `path.resolve(cwd, '.env')` and writes `MOCHI_KEY=<32-byte base64url secret>`, and `packages/docs/183-cli.md:88` documents it as 'Generates a MOCHI_KEY ... and writes it to `.env` in the current directory'. Bun auto-loads `.env`, so this is the documented happy path for every Mochi app.

Result: `docker build .` in a scaffolded project embeds the plaintext `MOCHI_KEY` (plus any `DATABASE_URL`, `SMTP_PASS`, `ADMIN_PASSWORD`, or third-party API keys the user added) into an image layer. Image layers are not a secret store: anyone who can pull the image, read a registry layer blob, or run `docker history --no-trunc` / `docker save` + untar recovers the value, and the layer retains it even if a later instruction deletes the file.

Impact is wide because `MOCHI_KEY` is a single-point secret. Per the framework docs it keys server-island prop sealing (`70-server-islands.md:234`), signed image-transform URLs (`148-images.md:17`), PoW captcha tokens (`150-captcha.md:125`), and protection clearance cookies (`152-protection.md:80`). Disclosure lets an attacker forge server-island prop payloads, mint arbitrary image-transform URLs (turning the `/_mochi/image` endpoint into an SSRF/transform-abuse primitive the docs explicitly say encryption is the boundary for — `148-images.md:262`), forge captcha solutions, and self-issue protection clearance. The docs' own warning is unambiguous: 'Never commit MOCHI_KEY. It signs server-island prop URLs. A leak lets attackers forge them. Supply it through your platform's secret store' (`70-server-islands.md:250`).

That the repo's root `.dockerignore` *does* list `.env*` (alongside a comment about never shipping a dev database) shows this is a template oversight rather than an intentional trade-off. The exposure is compounded on the git side: `packages/minimal/.gitignore` is only `node_modules`, `.mochi`, `*.tsbuildinfo`, and `ensureGitignore()` (`packages/cli/src/utils.ts:197`) returns early when the template already ships a `.gitignore` — so its `DEFAULT_GITIGNORE`, which *does* contain `.env`, is never applied, and scaffolded projects will also commit `.env` to version control. `packages/demos/.gitignore` has the identical gap and ships no `.dockerignore` at all. (Nothing is leaking from this repository itself — the root `.gitignore` covers `.env` at all depths, and `git ls-files packages/demos/.env` is empty.)

Severity is MEDIUM because it requires the user to supply a secret and build/distribute the image; impact reaches HIGH for anyone who pushes the resulting image to a shared, public, or multi-tenant registry — a routine outcome for a Dockerfile handed out by a scaffolder.

## Recommendation

Add `.env` and `.env*` to `packages/minimal/.dockerignore` (mirroring the root `.dockerignore`), and add the same entries plus `.env.local` to `packages/minimal/.gitignore` and `packages/demos/.gitignore`. Also ship a `.dockerignore` with the `demos` template. For defense in depth, make `ensureGitignore()` in `packages/cli/src/utils.ts` *merge* its `DEFAULT_GITIGNORE` entries into an existing template `.gitignore` rather than returning early, so a template that forgets `.env` can never produce a scaffold that commits secrets. Optionally narrow line 8 to explicit paths (`COPY src ./src`, `COPY public ./public`, `COPY svelte.config.js tsconfig.json ./`) so new secret-bearing files are opt-in rather than opt-out, and document that `MOCHI_KEY` must be injected at runtime (`docker run -e MOCHI_KEY=...` or a secret store), never baked at build time.

## Revalidation

**Verdict:** true-positive

Every link in the chain verified. packages/cli/src/templates.ts:14-27 points the `minimal` template at `khromov/mochi/packages/minimal` with no `#ref`, so download.ts:15's `const [pathPart = '', ref = 'HEAD']` resolves to the live default branch; `extractTemplate()` (download.ts:33-46) globs the subdir and writes every match with `Bun.write`, with no filter, allowlist or exclusion anywhere in cli.ts/create.ts/download.ts/utils.ts; and download.test.ts:58-59 asserts `.gitignore` survives extraction. I confirmed this empirically rather than by inference: cli-tests/mochi-test-1785454573-minimal/ is a real scaffold output containing both `.dockerignore` and a `Dockerfile` byte-identical to the template apart from the then-current base tag. packages/minimal/.dockerignore is six lines (node_modules, .git, .mochi, Dockerfile, .dockerignore, *.log) with no `.env*`, while line 8's `COPY . .` sits in a single-stage build, so anything matched persists in the final image layer. The secret source is the documented path: packages/mochi/src/cli/generateKey.ts:29-34 resolves `path.resolve(cwd, '.env')` and writes `MOCHI_KEY=…`, documented at packages/docs/183-cli.md:88, and Bun auto-loads `.env`. Two pieces of evidence make this an oversight rather than a trade-off: the root .dockerignore:8 does list `.env*`, and packages/docs/185-docker.md:48-53 prints a recommended `.dockerignore` that includes `.env*` — the shipped template contradicts the project's own documentation. The `.gitignore` compounding claim also checks out: `ensureGitignore()` (utils.ts:196-203) returns early when the file exists, so DEFAULT_GITIGNORE's `.env`/`.env.local` (utils.ts:190-191) never reach a scaffold, and packages/demos/.gitignore has the same gap. The caveat that keeps this at MEDIUM is correctly stated in the finding: create-mochi does not itself create a `.env` (minimal references MOCHI_KEY nowhere), so the user must put a secret there and then build/distribute the image — routine given the docs, but a required precondition.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-10-26)
