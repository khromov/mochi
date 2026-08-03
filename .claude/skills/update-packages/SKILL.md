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

### `svelte-shaker` (`packages/mochi`) — a floor, not a pin

Declared as `>=0.18.1` rather than an exact version. We drive its internal `svelte-shaker/node` subpath on a pre-1.0 package, and the floor is a correctness boundary: below 0.18.1 the shaker strips `mochi:*` directives, silently turning islands into plain components. Because it is a floor in a published package, a future regressed release _can_ reach consumers — so treat every observed bump as potentially breaking. Verify with a real `bun run build:site` (the `slimmed N of M` line must be non-zero and the "optimization skipped" warning absent — shake failures are swallowed by the fallback) plus `bun test packages/mochi/src/compiler/svelteShaker.test.ts`. See the comment in `packages/mochi/src/compiler/svelteShaker.ts`.

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
for p in cli demos docs minimal mochi msgpackr-extract-stub shared site support video-animations; do
  echo "=== $p ==="
  (cd packages/$p && bun update 2>&1 | grep -E '^\^|packages installed')
done
```

**Never use `bun update --latest`.** It rewrites declared specs to the newest version regardless of carve-outs and blows through every exact pin.

`bun update` rewrites the declared caret ranges to the new minimums (`^5.56.5` → `^5.56.7`). That is fine and keeps workspaces in agreement. Anything the ranges can't reach — 0.x minors, approved majors — needs a hand edit to `package.json` followed by `bun install`.

Re-run `bun outdated --filter='*'` and confirm the only remaining rows are the agreed carve-outs.

## 4. Deduplicate — do not skip this

Incremental per-workspace updates leave duplicate physical copies of packages under `packages/*/node_modules`, even at identical versions. Two copies of Svelte means two module instances and two context maps, which breaks `getContext` across the boundary — every page 500s with `lifecycle_outside_component`, and `isHydratable()` is the usual first casualty. The lockfile is fine; only the local tree is wrong, so CI and fresh checkouts won't show it.

```sh
rm -rf node_modules packages/*/node_modules && bun install
ls -d packages/*/node_modules/svelte 2>/dev/null   # must print nothing
ls -d node_modules/.bun 2>/dev/null                # must print nothing (see CLAUDE.md on the hoisted linker)
```

## 5. Verify

Green tests are necessary but nowhere near sufficient. Work down this list; the build-output comparison is the step that catches what the others miss.

1. **`bun run syncpack`** — cross-workspace version agreement. Peer ranges are checked too, so if a dep's new version raises a peer requirement, update the corresponding `peerDependencies` entry in `packages/mochi/package.json` to match.

2. **`bun run checks`** — lint:fix + format + typecheck + test. Per CLAUDE.md, delegate to a Sonnet sub-agent that reports only pass/fail plus failures.

3. **`bun run build`** — full workspace prebuild. **Capture the summary lines and compare them against the same build before the update.** Watch for:
   - page / client-file / island counts moving unexpectedly
   - any build-time optimization reporting that it was skipped or fell back
   - warnings from compiler-adjacent deps

   A build that succeeds is not a build that is correct. Optimizations in this repo are guarded by fallbacks that log and continue, so a broken dependency shows up as a _bigger bundle and a log line_, never as a failure. If a count moved, explain why before proceeding.

4. **Browser smoke test** — `curl` only exercises SSR HTML and will not catch hydration breakage (the duplicate-copy failure in step 4 is invisible to a 200-status check on some routes). Start a server on a non-colliding port and drive it with the `chrome-devtools` MCP:

   ```sh
   PORT=4444 bun run dev:site
   ```

   Load `/`, a docs page (`/docs/jobs/` — `/docs/` itself is not a route), and at least two island-heavy demos. On each: `list_console_messages` for hydration mismatches and uncaught errors, `list_network_requests` for failed `/_mochi/island/*` or asset fetches. Request routes with a trailing slash. Tear down with `pkill -f dev:site` and confirm via `pgrep -x bun`.

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
