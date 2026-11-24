# [MEDIUM] Headless Chrome is launched with --no-sandbox for every run, not just CI

**File:** [`scripts/site-health.ts`](https://github.com/khromov/mochi/blob/main/scripts/site-health.ts#L136-L468) (lines 136, 284, 468)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** low  •  **Slug:** `other-browser-sandbox-disabled`

## Owners

**Suggested assignee:** `stanislav.khromov@gmail.com` _(via last-committer)_

## Finding

CHROME_BACKEND (L136) hardcodes `argv: ['--no-sandbox', '--disable-dev-shm-usage']` and is used for every Bun.WebView created — the preflight probe (L468) and every per-page check (L284). The script's whole job is to render remote HTML/JS: it loads every URL from the sitemap of whatever origin is passed as `base` (default https://mochi.fast, but any http(s) origin is accepted at L87-91), executes its scripts, and waits out a 1500ms settle window for deferred islands to hydrate. Chrome's OS-level sandbox is the primary containment for a compromised renderer; with it disabled a renderer-level exploit in any loaded page executes with the full privileges of the invoking user — a developer's workstation when run locally, or the CI job's environment (including its GITHUB_TOKEN and any job secrets) when run from site-health.yml. The inline comment justifies the flags for GitHub Actions runners ('GitHub Actions runners can't initialize Chrome's sandbox'), which is accurate, but the constant is applied unconditionally, so local runs — including runs pointed at a staging, forked, or third-party origin — silently inherit the CI-only weakening. Exploitation requires a Chrome renderer vulnerability, so this is defense-in-depth rather than a directly exploitable flaw, but the mitigation is free and the current blast radius is a developer machine.

## Recommendation

Only add the sandbox-disabling flags when running under CI, e.g. `const CHROME_BACKEND = { type: 'chrome', argv: process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] }`. If the flags are needed for a container-based local setup, require an explicit opt-in env var rather than defaulting to off.

## Revalidation

**Verdict:** true-positive

Confirmed exactly as described. CHROME_BACKEND at L136 hardcodes argv: ['--no-sandbox', '--disable-dev-shm-usage'] with no environment condition, and it is the backend for both the preflight probe (L468) and every per-page WebView (L284). I checked the local bun-types declaration (bun.d.ts ~L9745-9812): argv is 'Extra command-line arguments appended after the default flags' of the spawned Chrome, the defaults are '--remote-debugging-pipe --headless --no-first-run --no-default-browser-check --disable-gpu --user-data-dir=<temp>' (no sandbox flag), and critically 'Chrome is spawned once per process — the first new Bun.WebView() call's path/argv/dataStore.directory win' — so the preflight's flags govern every tab for the whole run. --no-sandbox genuinely disables Chrome's OS-level renderer containment, including under new headless. git log confirms the intent: commit 13dc6cb8 is titled 'fix(site-health): pass --no-sandbox so Chrome launches under Bun.WebView in CI', i.e. a CI-only need implemented unconditionally. The script's purpose is to render and execute remote pages (and it demonstrably loads third-party JS — IGNORE_PATTERNS L103-106 mutes noise from the external u.khromov.se/u.js analytics script), so the weakened boundary is exercised on every run. Two calibrations against the finding's write-up: in CI the blast radius is smaller than claimed — site-health.yml declares 'permissions: contents: read' and the job references no secrets, so there is no meaningfully privileged GITHUB_TOKEN to steal; and the workflow_dispatch 'base' input can only be set by someone who already has repo write. The real residual risk is therefore the local-developer case the finding identifies, and exploitation still requires a Chrome renderer vulnerability, making this hardening/defense-in-depth rather than a directly exploitable flaw. I am keeping MEDIUM only because it is the lowest security tier available in the severity enum; on a Low/Medium/High scale this belongs at Low. The recommendation (gate the flags on process.env.CI) is correct and free, and the same unconditional pattern was introduced by that commit into packages/site/scripts/bake-og-assets.ts and shoot.ts, which are outside this finding's file scope but worth fixing together.

## Recent committers (`git log`)

- Stanislav <stanislav.khromov@gmail.com> (2026-08-22)
- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-22)
