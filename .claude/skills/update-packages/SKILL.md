---
name: update-packages
description: Sweep every workspace's dependencies up to current, verify nothing regressed, and open a PR. Use when the user asks to "update packages", "update deps", "bump dependencies", or "run bun outdated and update".
user-invocable: true
---

# Update packages across the monorepo

Refreshes dependencies in every workspace, verifies the result, and opens a PR. The whole point is the verification: a dependency sweep that only proves `bun run checks` is green has not been verified, because the most damaging dependency regressions in this repo are invisible to the test suite.

## 1. Survey

```sh
bun outdated --filter='*'
```

The root script `bun run outdated` is the same command. Read the whole table before touching anything — the `Update` column is what the declared range allows, `Latest` is what exists. A row where `Current == Update < Latest` means the range is holding it back (a major, or a 0.x minor), so it needs a deliberate decision and a manual `package.json` edit.

## 2. Decide the carve-outs before editing

Ask the user (`AskUserQuestion`) about anything in these categories rather than assuming:

- **Majors.** Look up the actual breaking changes (changelog / release notes / `gh api repos/<owner>/<repo>/releases`) and check our real usage before recommending. Often the breaking change doesn't touch us — e.g. a CJS-drop is a no-op for a package that is already `"type": "module"`.
- **0.x minors.** Semver-exempt; treat each as a potential major.
- **Anything with a deliberate exact pin** (see below).

Do not decide these silently in either direction. "It wasn't in the exclusion list" is not consent to bump a major.

### Deliberate exact pins — never bump in a routine sweep

These are pinned with no caret on purpose. A plain `bun update` will not move them; do not "helpfully" widen or bump them without asking:

| Pin                                                                         | Why                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svelte-check` (all workspaces)                                             | Carries a patch — root `patchedDependencies` keys on the exact version (`svelte-check@4.7.3` → `packages/mochi/patches/…`). Bumping it orphans the patch; the version must be changed in `patchedDependencies`, the patch filename, and every workspace together. |
| `@types/bun` (all workspaces)                                               | Tracks the pinned Bun version. Use the `update-bun` skill, not this one.                                                                                                                                                                                          |
| `@noble/ciphers`, `ipaddr.js`, `@joint-ops/hitlimit-bun` (`packages/mochi`) | Pinned in a published package's runtime deps.                                                                                                                                                                                                                     |
| `satori`, `@resvg/resvg-js`, `subset-font` (`packages/video-animations`)    | Satori's output is pixel-sensitive; a bump can silently shift frame rendering.                                                                                                                                                                                    |
| `tmcp`, `@tmcp/*`, `valibot`, `svelte-french-toast` (`packages/site`)       | Pinned to known-good versions.                                                                                                                                                                                                                                    |

### `svelte-shaker` (`packages/mochi-svelte-shaker`) — a floor, not a pin

Declared as `>=0.18.1` rather than an exact version. We drive its internal `svelte-shaker/node` subpath on a pre-1.0 package, and the floor is a correctness boundary: below 0.18.1 the shaker strips `mochi:*` directives, silently turning islands into plain components. Because it is a floor in a published package, a future regressed release _can_ reach consumers — so treat every observed bump as potentially breaking. Verify with `bun --cwd=packages/mochi-svelte-shaker run test`: its `build.isolated.test.ts` drives a real `mochi-framework build` and asserts a non-zero `slimmed N of M` line with no "optimization skipped" warning, which is the only automated guard — shake failures are otherwise swallowed by the fallback. No app in the repo enables `optimize`, so there is no second signal. See the comment in `packages/mochi-svelte-shaker/src/index.ts`.

### `@rsvelte/vite-plugin-svelte-native` (`packages/mochi-rsvelte`) — a floor, not a pin

Declared as `>=0.2.8 <1.0.0`, same philosophy as `svelte-shaker`: a deliberate floor range that intentionally admits 0.x _minor_ bumps (0.2 → 0.3), which are semver-exempt and therefore potential majors. A `bun update` inside the workspace **will** move it within that range. It's fine to take the bump, but verify it the way the floor is protected in CI: a real `bun run build` must build `minimal-rsvelte` through `@mochi-framework/rsvelte` without falling back to `svelte/compiler` — its `scripts/build.ts` wrapper **fails** on fallback, so a green minimal-rsvelte build is the signal.

### Held majors — caret-bounded, do not bump the major without re-deciding

These are ordinary caret ranges (`^6.x`, `^1.x`), so `bun update` holds them at their current major automatically and they won't appear as moved rows — but a routine sweep must **not** widen them to the next major. They're recorded here (decided 2026-08) so the same major isn't re-litigated every sweep; revisit only when the stated trigger clears.

| Held at        | Latest | Where                                     | Why held / re-evaluation trigger                                                                                                                                                                                                                                                                                                      |
| -------------- | ------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript@6` | 7.x    | all workspaces                            | TS 7 is the Go-native compiler rewrite; its programmatic compiler API — relied on by `svelte-check` (patched + pinned here), `typescript-eslint`, and Svelte's own type tooling — is not guaranteed stable until **7.1**. Hold on `^6` until 7.1 ships a stable API and `svelte-check` / `typescript-eslint` support the Go compiler. |
| `msgpackr@1`   | 2.x    | `packages/msgpackr-extract-stub` (devDep) | Only used by the stub's own roundtrip test. The framework runtime runs msgpackr **1.x** because `bunqueue` pins `^1.11.8`; the stub's test dep must track that major so the test stays representative. Bump only once the runtime (via `bunqueue`) actually moves to msgpackr 2.                                                      |

## 3. Update

Branch first — never do this on `main`.

```sh
git checkout -b chore/update-deps
```

**Root deps:**

```sh
bun update
```

**Workspace deps — one `bun update` per workspace.** As of Bun 1.3.14, neither `bun update --recursive` nor `bun update --filter='*'` actually updates workspace dependencies; they report "no changes" while `bun outdated` still lists everything. You must run `bun update` from inside each workspace directory:

```sh
for p in cli demos docs minimal mochi mochi-rsvelte mochi-svelte-shaker minimal-rsvelte msgpackr-extract-stub shared site support video-animations; do
  [ -d "packages/$p" ] || continue
  echo "=== $p ==="
  (cd packages/$p && bun update 2>&1 | grep -E '^\^|packages installed')
done
```

**Never use `bun update --latest`.** It rewrites declared specs to the newest version regardless of carve-outs and blows through every exact pin.

`bun update` rewrites the declared caret ranges to the new minimums (`^5.56.5` → `^5.56.7`). That is fine and keeps workspaces in agreement. Anything the ranges can't reach — 0.x minors, approved majors — needs a hand edit to `package.json` followed by `bun install`.

**`bun update` also collapses floor ranges into carets — silently _narrowing_ them.** A deliberate floor like `svelte-shaker` (`>=0.18.1`) or `@rsvelte/vite-plugin-svelte-native` (`>=0.2.8 <1.0.0`) comes back as `^0.18.1` / `^0.3.3`, which locks to a single 0.x minor and defeats the floor's whole point (the next sweep's `bun update` can no longer reach `0.19` / `0.4`). The intended "bump" for these is the _lockfile_ moving, not the spec format changing. After updating, `git diff` the floor specs and **restore any `>=…` range `bun update` rewrote to a caret**, then `bun install` to reconcile (the resolved version stays put). Grep for it: `git diff -- '**/package.json' | grep -E '^[-+].*(svelte-shaker|vite-plugin-svelte-native)'`.

Re-run `bun outdated --filter='*'` and confirm the only remaining rows are the agreed carve-outs.

## 4. Deduplicate — do not skip this

Incremental per-workspace updates can leave duplicate physical copies of packages under `packages/*/node_modules`, even at identical versions. Two copies of Svelte means two module instances and two context maps, which breaks `getContext` across the boundary — every page 500s with `lifecycle_outside_component`, and `isHydratable()` is the usual first casualty. The lockfile is fine; only the local tree is wrong, so CI and fresh checkouts won't show it.

> **zsh footgun — the glob below will FALSE-PASS.** With the hoisted linker, everything is hoisted to the root `node_modules`, so `packages/*/node_modules` usually matches nothing. Under zsh's default `NOMATCH`, an unmatched glob **aborts the entire command line** — so `rm -rf node_modules packages/*/node_modules && bun install` runs neither the `rm` nor the `bun install`, and the two `ls … 2>/dev/null || echo '(none - good)'` checks _also_ nomatch and fall through to their fallback, printing a fake pass. You'll think you deduped when nothing happened. So: dedup is really just root `rm -rf node_modules && bun install`, and the checks must tolerate no-match (`find`, not a bare glob):

```sh
rm -rf node_modules && bun install
# under the hoisted linker there are normally no per-package node_modules at all:
find packages -maxdepth 3 -path '*/node_modules/svelte' -type d 2>/dev/null   # must print nothing
[ -d node_modules/.bun ] && echo 'FOUND .bun (bad)' || true                   # must print nothing (see CLAUDE.md on the hoisted linker)
find . -path '*/node_modules/svelte/package.json' -not -path '*/.bun/*' 2>/dev/null  # expect exactly one, at root
```

## 5. Verify

Green tests are necessary but nowhere near sufficient. Work down this list; the build-output comparison is the step that catches what the others miss.

1. **`bun run syncpack`** — cross-workspace version agreement. Peer ranges are checked too, so if a dep's new version raises a peer requirement, update the corresponding `peerDependencies` entry in `packages/mochi/package.json` to match.

2. **`bun run checks`** — lint:fix + format + typecheck + test. Per CLAUDE.md, delegate to a Sonnet sub-agent that reports only pass/fail plus failures. **It can run well past 10 minutes** — the framework's per-file test isolation (`run-tests.ts` spawns one `bun test` process per file) is the long pole. A single foreground `Bash` call caps at the 10-minute tool max, so a sub-agent that runs `bun run checks 2>&1 | tail` foreground will hit that ceiling and "complete" with no verdict while the process keeps running detached. Instead have the sub-agent **run it in the background** (tee to a log) and **poll the log for the final `Exited with code N`** on a ~20-minute budget before reporting. Don't launch a second `checks` run while one is still alive (`pgrep -f "bun run checks"`).

3. **`bun run build`** — full workspace prebuild. **Capture the summary lines and compare them against the same build before the update.** Watch for:
   - page / client-file / island counts moving unexpectedly
   - any build-time optimization reporting that it was skipped or fell back
   - warnings from compiler-adjacent deps

   A build that succeeds is not a build that is correct. Optimizations in this repo are guarded by fallbacks that log and continue, so a broken dependency shows up as a _bigger bundle and a log line_, never as a failure. If a count moved, explain why before proceeding.

4. **Browser smoke test** — `curl` only exercises SSR HTML and will not catch hydration breakage (the duplicate-copy failure in step 4 is invisible to a 200-status check on some routes). Start a server and drive it with the `chrome-devtools` MCP:

   ```sh
   bun run dev:site
   ```

   Load `http://localhost:3333/`, a docs page (`/docs/queues/` — `/docs/` itself is not a route), and at least two island-heavy demos. On each: `list_console_messages` for hydration mismatches and uncaught errors, `list_network_requests` for failed `/_mochi/island/*` or asset fetches. Request routes with a trailing slash. Tear down with `pkill -f dev:site` and confirm via `pgrep -x bun`.

5. **`bun run cli-test`** if template packages (`minimal`, `demos`) moved versions.

## 6. Commit and PR

Commit as `fix(deps):` rather than `chore(deps):` when anything in published `mochi-framework`'s dependency or peer-dependency graph changed — consumers should get a release. Pure devDependency/tooling sweeps are `chore(deps):`.

The PR body should carry a bump table, each carve-out with its reason, and the verification evidence (including the before/after build numbers). Anything held back needs a stated reason and, when it's a bug rather than a policy choice, a written-up repro so it can go upstream.

Per CLAUDE.md, committing, pushing, and opening the PR each require explicit user go-ahead — "update the packages and open a PR" grants it for that run; "update the packages" alone does not.

## Notes

- Look up versions with `bun info <pkg> version` / `bun info <pkg>` rather than relying on training data.
- To inspect a package's real exports or metadata before committing to a bump, `npm pack <pkg>@<version>` into the scratchpad and read its `package.json` and `.d.ts` files. Diffing the old and new typings is the fastest way to confirm our call sites are source-compatible.
- If a dependency turns out to be broken, bisect it with a **minimal standalone repro** in the scratchpad — a few files, no framework, calling the library directly — rather than reasoning from our build. Confirm the exact version that introduced it, then pin below it and write the repro up.
- Report faithfully: if you verified a step by grepping partial output, say so. Build errors often print early and get missed by a `tail`.
