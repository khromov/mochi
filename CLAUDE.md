# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Bun workspaces monorepo (`packages/*`):

- `packages/mochi` — the `mochi-framework` library (published to npm). All framework source lives here.
- `packages/mochi-rsvelte` — published as `@mochi-framework/rsvelte`: the opt-in Rust compiler backend behind `Mochi.serve({ svelteCompiler: 'rsvelte' })`. Owns the `@rsvelte/*` dependency tree; `mochi-framework` holds only an optional peer and falls back to `svelte/compiler` without it. Raw TS, no build step.
- `packages/mochi-svelte-shaker` — published as `@mochi-framework/svelte-shaker`: the opt-in whole-program `.svelte` source optimizer behind `Mochi.serve({ optimize })`. Owns the `svelte-shaker` dependency and its `>=0.18.1` correctness floor; `mochi-framework` holds only an optional peer and warns once at boot when `optimize` is on without it. Raw TS, no build step.
- `packages/site` — main site that consumes `mochi-framework` via `workspace:*`; serves the marketing pages, the docs (rendered from `packages/docs` markdown), and the inline demos. Port 3333. Its blog pages embed the newsletter widget hosted by `packages/support` cross-origin (`NEWSLETTER_EMBED_URL` overrides the target).
- `packages/demos` — standalone demos site (HN clone, todo, admin). Deployed separately from `packages/site`. Port 3334.
- **`demos` and `minimal` are `create-mochi` template sources, fetched from `main` and paired with the _published_ `mochi-framework`** (`packages/cli/src/create.ts` rewrites `workspace:*` to the latest npm version). So they must stay compatible with the last release, not just with HEAD: never drop an option from them because HEAD made it redundant — a scaffold built today would hand that file to an older framework with the old default. Keep `packages/minimal-rsvelte` in step with `minimal` for the same reason it exists (one diff: `svelteCompiler`).
- `packages/minimal` — smallest possible Mochi app; doubles as the smoke-test target and the `create-mochi` template source. Port 3335.
- `packages/minimal-rsvelte` — copy of `minimal` pinned to `svelteCompiler: 'rsvelte'`. Exists so CI builds a whole app through `@mochi-framework/rsvelte` on Linux/macOS/Windows; its `scripts/build.ts` wraps `mochi-framework build` and **fails** if the build fell back to `svelte/compiler` (the framework's fallback is silent by design). Port 3337, started only by `bun run dev:full`. Not deployed, not a `create-mochi` template.
- `packages/shared` — `mochi-shared`: tiny private helpers shared by the deployed sites (currently just the Umami `analytics` handle). **Only for `site` / `support` — never import it from `packages/mochi`**, which is published to npm and must not depend on a private workspace package, nor from `demos` / `minimal`, which double as template sources and must only depend on published packages (duplicate the helper there instead). See its README.
- `packages/support` — the support form at `support.mochi.fast`. Port 3336. Deployed separately via `Dockerfile.production`. It lives apart from `packages/site` because it is the only site configured with a real SMTP transport (`Mochi.serve({ email })`, driven by `SMTP_*` env vars — see its `.env.example`); every other site rides the framework default, which never sends. Refuses to boot in production without `ADMIN_PASSWORD` + `SMTP_HOST` + `MOCHI_ORIGIN`. It also hosts the **newsletter signup widget** at `/newsletter/embed/` (`src/newsletter/`), which `packages/site` iframes at the bottom of the blog via `@nprapps/sidechain`: a second queue (`newsletter-emails`) on the app's durable `.db/queue.sqlite` store mails the double opt-in confirmation, `src/embedHeaders.ts` sets the `frame-ancestors` CSP, subscribers share `.db/support.sqlite`, and the embed page overrides the shell's `body { min-height: 100vh }` so the iframe can shrink as well as grow. The host's theme reaches the guest through `?theme=` (applied pre-paint by `src/shell.html`) plus a postMessage for later toggles.
- `packages/docs` — `mochi-docs`: markdown content only (no server/scripts of its own); consumed and rendered by `packages/site`.
- `packages/docker` — `mochi-docker`: internal docker-compose stack for local dev — Postgres 15 (host `5433`, `postgres`/`postgres`) + Adminer (host `8081`), data bind-mounted at `./.db` (gitignored, no named volume). Host ports are `5433`/`8081` (not `5432`/`8080`) so it coexists with the dev container's native Postgres (5432) and code-server (8080). Auto-started by `bun run dev`; its dev script warns and idles when Docker is unavailable (so it never triggers dev.ts's first-exit teardown). `bun run db:stop` / `db:down` / `db:reset` from the root.
- `packages/cli` — published as `create-mochi`: the `mochi-framework build` and project-scaffolding CLI (`@clack/prompts` + `commander`). Its `src/lintSetup.ts` writes the optional ESLint/Prettier setup into scaffolds as embedded string constants (the published package ships raw `src/`, no build step): generated configs mirror the root `eslint.config.js`/`.prettierrc`, and the pinned devDep caret ranges must stay identical to the root `package.json`'s lint stack — a `lintSetup.test.ts` test enforces this, so whenever the root's eslint/prettier deps are bumped (e.g. by the update-packages sweep), update `lintSetup.ts` to match; if the root lint/prettier _config_ changes, mirror it in `renderEslintConfig`/`PRETTIERRC` too.
- `packages/msgpackr-extract-stub` — published as `@mochi-framework/msgpackr-extract-stub`; a pure-JS stub wired in via the root `overrides` so the native `msgpackr-extract` is never built.
- `packages/video-animations` — Satori-based frame generation for promo videos (`bun run mochi:animate`). Satori (yoga) rounds element `left`/`top` to the integer pixel grid, so animate position via `transform: translate(${x}px, ${y}px)` with the element pinned at `left:0/top:0` — driving per-frame motion through `left`/`top` stair-steps and jitters ~1–2px. See `leaf()` in `src/frame.ts`.
- `packages/remotion` — rendered video output assets.

Root `package.json` scripts delegate into packages with `bun --cwd=packages/<name> run …` or fan out with `bun --filter='*' run …`. Most framework work happens inside `packages/mochi/src/`; app work lives in `packages/site/src/` and `packages/demos/src/`.

## Commands

```sh
bun run dev          # scripts/dev.ts: auto-discovers every package with a `dev` script and runs them
                     # in parallel with color-prefixed logs — site (3333), demos (3334), minimal (3335), support (3336)
bun run dev:full     # Same, plus the packages in dev.ts's FULL_ONLY set — minimal-rsvelte (3337)
bun run dev:site     # Just the main site
bun run dev:demos    # Just the demos site
bun run start        # Start the main site in production mode
bun run start:all    # Run all production-capable sites
bun run build        # Pre-build islands across workspaces (parallel via `bun --filter`)
bun run clean        # Remove .mochi/ across workspaces
bun run typecheck    # tsc --noEmit across all workspaces
bun run test         # Run tests across all workspaces (bun test)
bun run checks       # lint:fix + format + typecheck + test — the standard pre-done gate (delegate to a sub-agent from the main context; run it directly if you already are one)
bun run lint         # eslint . (ignores .mochi/, packages/site/.mochi/, .claude/)
bun run lint:fix     # eslint . --fix
bun run format       # prettier --write .
bun run format:check # prettier --check . (used by CI)
bun run syncpack     # syncpack lint — verify dependency versions agree across workspaces (syncpack:fix to apply)
bun run loc          # Lines-of-code report for all packages (.github/scripts/loc-report.ts)
bun run deps         # Dependency report (packages/mochi/scripts/dep-report.ts)
bun run cli-test     # create-mochi CLI regression test (.github/scripts/cli-regression-test.ts)
bun run mochi:animate # Generate promo-video frames (packages/video-animations)
```

Multi-package scripts (`build`, `test`, `typecheck`, `clean`, `start:all`) use `bun --filter='*' run <script>`, which fans out to every workspace, runs in topological order, and parallelises siblings. `bun run dev` instead uses `scripts/dev.ts`, which dynamically discovers packages exposing a `dev` script.

Run a single test file: `bun test packages/mochi/src/runtime/forms.test.ts` (or pass `-t <pattern>` to filter).

### Testing: per-file isolation

Every test file runs in its own `bun test` process, up to a capped number of files in parallel: **6 locally** (to keep the machine usable), or set `MOCHI_MAX_CONCURRENCY` to a number — or `max`/`auto` for full `navigator.hardwareConcurrency` — to override (CI sets `max`). The cap is platform-independent; Windows used to be pinned to 1, but that was an untested guess about the shutdown wedge described below (measured over 27 Windows samples in PR #305 — 168/168 at every fan-out, and ~2.2× faster at 4 workers), and the wedge is now absorbed directly. `packages/mochi/scripts/run-tests.ts` globs `src/**/*.test.ts`, spawns each file individually, and aggregates exit codes. This avoids `globalThis.__mochi_config__` conflicts from multiple `Mochi.serve()` calls, `GlobalRegistrator` pollution, and test-global pollution from compiling the same Svelte entrypoint twice. Parallelism is safe because every test uses unique temp dirs (`mkdtempSync`) and `port: 0`.

**The Bun-on-Windows shutdown wedge.** Some files pass every test and then hang in Bun's native post-test shutdown — a runtime bug with no JS-level recovery. `bun test` writes its junit report only after the run (including `afterAll`) completes, so a _complete_ report proves the work is done and anything still alive is wedged rather than working. `runTests` polls for that report, gives the child `WEDGE_GRACE_MS` to exit on its own, then kills it; on Windows a wedge after a green report counts as a pass (`toleratedWindowsWedge`). A file with no report is a genuine hang and still fails on `fileTimeoutMs`. Note that `parseJunitSummary` succeeding is **not** a completion check — the totals live in the root `<testsuites>` open tag, so a half-written report parses fine; use `junitReportIsComplete`, which requires the closing tag. If one specific file misbehaves under parallel load on Windows, `runTests({ windowsSequential: [...] })` moves it to the one-at-a-time lane — but let the telemetry name it first rather than quarantining on suspicion.

**A `Mochi.serve()` `outDir` must live inside the project tree** — the existing tests `mkdtempSync` into `packages/mochi/`, not `/tmp` or the session scratchpad. Mind the depth: a test at `src/*.test.ts` uses `path.join(import.meta.dir, '..', '.mochi-…-')`, while one in a subfolder (`src/runtime/`, `src/compiler/`, …) needs `'..', '..'`. Getting this wrong doesn't fail — it silently writes build output into `src/`, which is gitignored and only surfaces later as bizarre `svelte-check` errors in a directory nobody wrote. The on-demand server-island path compiles each island to `<outDir>/svelte-compile/<Name>-<hash>.server.js` and dynamically `import()`s it; that module's deps (framework runtime, `@noble/ciphers`) resolve relative to `outDir`, so an `outDir` under `/tmp` has no `node_modules` chain back to the project and fails with `Cannot find module '…/svelte-compile/….server.js' from ''` (a 500 at `/_mochi/island/:name`). The prebuilt/manifest path stores artifact paths outDir-relative and resolves them against the manifest's own directory — `fromManifest()` takes no outDir argument — so a build output relocates with its directory, but the imported SSR modules still resolve `node_modules` from that directory, so the inside-the-project-tree rule applies to it too. It also stores _source_ paths (the `components` keys, `cssFileUrls` keys, `resolvedPath`, `serverIslandPaths`, …) project-root-relative against `process.cwd()` at both build and serve, with framework-owned sources under a `$mochi/` sentinel — see `compiler/manifestPaths.ts`. A test that `mkdtemp`s inside `packages/mochi` therefore gets keys relative to `packages/mochi`; assert on manifest source keys via `encodeSourcePath()` (or the literal sentinel, where the point is that the framework's own paths are layout-independent), never a hard-coded absolute path. When writing an ad-hoc `Mochi.serve()` repro, put `outDir` under the package even though generic temp files belong in the scratchpad.

#### The hoisted-linker requirement

Root `bunfig.toml` pins `[install] linker = "hoisted"` to avoid a Bun bundler bug where a second in-process `Bun.build()` inside a `bun test` process can fail under the isolated install linker's symlinked `node_modules/.bun` store — do not remove it, and don't reintroduce subprocess-build indirection in tests: calling `build()` in-process from a test is fine under the hoisted layout (see `buildServerIslandManifest.test.ts`). Pinning the hoisted linker removes only this double-build reason for per-file isolation — it does **not** let us drop `run-tests.ts`. `Mochi.serve()` still pins a one-per-process singleton (`__mochi_config__`, plus siblings `__mochi_image_runtime__`/captcha/image/email config) that `server.stop()` never clears, so plain `bun test` works for pure unit tests but any second server-booting file throws "Mochi.serve() has already been called." — full-app tests stay one-file-per-process.

### CI: the Windows leg is a little flaky

A red Windows build on its own is not evidence of a regression. Re-run the job first; only treat it as real once it fails a second time, or once another platform fails too. Investigate immediately (without re-running) when the failure names a path with backslashes, or when the same leg is red on other PRs — that is the signature of a genuine Windows bug rather than flake.

## Architecture

Mochi is an islands framework for Svelte 5 + Bun with islands-based selective hydration. Components render server-side on every request; only components marked with `mochi:hydrate*` or `mochi:defer` ship JavaScript to the browser.

### Framework entry points (`packages/mochi/src/`)

Source is grouped by subsystem; only the entry points and public API surface (`Mochi.ts`, `index.ts`, `types.ts`, `events.ts`, `extensions.ts`, `mochiConfig.ts`, `highlight.ts`, `queue.ts`, the `.d.ts` files) sit at the top level, alongside the `Mochi.serve()`-level end-to-end tests.

- **`compiler/`** — the `.svelte` → JS pipeline: `ComponentRegistry.ts`, `svelteAstPreprocess.ts`, `svelteConfig.ts`, `svelteShaker.ts`, `compileCache.ts`, `preprocessCache.ts`, `serverOnlyScan.ts`, `buildInlineWebComponent.ts`, `freshImport.ts`, `tailwind.ts`.
- **`runtime/`** — the per-request pipeline: `requestSetup.ts`, `requestContext.ts`, `cookies.ts`, `csrf.ts`, `proxy.ts`, `trailingSlash.ts`, `errors.ts`, `hooks.ts`, `rateLimit.ts`, `warmup.ts`, `publicDir.ts`, and forms (`forms.ts`, `formsJson.ts`, `enhance.*`).
- **`islands/`** — `islandPropsRegistry.ts`, `serverIslandCrypto.ts`, `payloadCrypto.ts`.
- **`cache/`** — `cache.ts`, `cache-storage.ts`.
- **`cli/`** — `cli.ts` (+ the `cli.js` bin shim), `build.ts`, `updateSkill.ts`, `generateKey.ts`, `checkEnvironment.ts`, `extractServeOptions.ts`, `testing.ts`.
- **`dev/`** — `devWatcher.ts`, `consoleLogger.ts`, and the built-in admin/dev routes.
- **`utils/`** — `index.ts` (the HTTP/asset helpers: `json`, `error`, `MochiHttpError`, …), `log.ts`, `htmlEscape.ts`, `globalState.ts`.
- **`components/`** — public, user-facing Svelte components (`mochi-framework/components`). Distinct from `templates/`, which is internal-only and minified via `.cocominify`.

`ComponentRegistry.ts` resolves sibling framework files as **string paths baked into generated source** (`path.join(SRC_DIR, 'utils/log.ts')` etc.) that no typecheck can see. `SRC_DIR` deliberately means `src/` even though the file lives in `src/compiler/`. If you move a file that appears in one of those literals, fix the literal in the same change and smoke-test the demo site.

- **`Mochi.ts`** — `Mochi.serve()` starts the Bun server. Route types:
  - `Mochi.page(path, { serverProps?, actions? })` — SSR Svelte page. `serverProps` is an object or `(req, params) => props` resolver. `actions` is a `MochiFormActions` map used for POST form submissions (see `forms.ts`).
  - `Mochi.api(handler)` — JSON API route with automatic `MochiHttpError` handling.
  - `Mochi.ws(handlers)` — WebSocket route (`upgrade`/`open`/`message`/`close`/`drain`).
  - `Mochi.sse(handler)` — Server-Sent Events stream (`send`/`close`/`onClose`).
- **`compiler/ComponentRegistry.ts`** — SSR compilation of `.svelte` via Svelte 5; preprocesses `mochi:hydrate`, `mochi:hydrate:visible`, `mochi:defer`, `mochi:defer:visible`; builds client bundles only for hydratable components; exposes the virtual `mochi-env` module that shadows `mochi-framework` inside compiled code (`isServer`, `isBrowser`, `isDev` — also real exports from `utils/env.ts`, which is what unbundled server code gets; that file is server-only and listed in `serverOnlyModuleGuard`, so any browser build reaching it fails naming the importer). New `mochi-framework` exports usable inside `.svelte` files must be added to **both** `mochi-env` `build.onLoad` blocks here — the server block (real re-export) and the client block (throwing browser stub) — not just `index.ts`; otherwise the SSR build fails with `No matching export in "mochi-env:mochi-framework"` (smoke-test the demo site — typecheck/unit tests won't catch it).
- **`runtime/hooks.ts`** — SvelteKit-style middleware. `Handle` receives `{ event, resolve }`. `sequence(...)` composes handles. `resolve(event, opts)` accepts `transformPage` / `filterResponseHeaders`.
- **`runtime/requestContext.ts`** — `getRequestContext()` returns `{ request, url, params, locals, cookies, form? }` via `AsyncLocalStorage`. Available in any server-side code (components, API handlers, server islands). The `AsyncLocalStorage` instance is pinned on `globalThis` so multiple bundled copies share state.
- **`runtime/forms.ts`** — `fail(status, data)`, `redirect(status, location)`, `success(data?)` return values from a `Mochi.page` action. `fail`/`success` re-render the page with a `form` prop; `redirect` issues the redirect response. A page route may not return its own `form` prop if it declares actions (reserved name).
- **`runtime/cookies.ts`** — `MochiCookieJar` on the request context. `cookies.get/set/delete` with `CookieSerializeOptions`.
- **`web-components/`** — `HydratableIsland.ts` (client bootstrap custom element) and `ServerIsland.ts` (defer-fetch loader).
- **`debug-bar/`** — Dev-only bottom toolbar (`<div id="mochi-dev-toolbar">` + a script); reads `window.__mochi_debug` seeded in the HTML shell.

### Entry point for the demo site

- **`packages/site/src/index.ts`** — configures middleware, calls `consoleLogger()`, and runs `Mochi.serve({ port: 3333, routes, handle, … })`.
- **`packages/site/src/routes.ts`** — all routes for the demo (pages, actions, APIs, WS, SSE). Add new routes here, not in `index.ts`.
- **`packages/site/src/demoIndex.ts`** — minimal `Mochi.serve()` example shown in every demo's `loadSources()`. Demos must reference this file (labelled as `index.ts`), **never** the real `./src/index.ts` — the real one carries site-wide middleware/branding that would obscure the demo.
- **`packages/site/src/demos/<name>/`** — each demo is a folder containing its Svelte component(s) and a `routes.ts` that exports the demo's routes. The top-level `routes.ts` imports and mounts them.

### HTML shell

Routes use a template (`packages/site/src/shell.html` or `packages/mochi/src/templates/default-shell.html`) with placeholders `{{mochi.head}}`, `{{mochi.css}}`, `{{mochi.body}}`, `{{mochi.script}}`. `Mochi.resolveHtmlShell()` injects compiled CSS/JS links, dev error overlay, live-reload, and the debug bar.

### Event bus and `consoleLogger()` (new pattern)

The framework emits lifecycle events through `mitt` rather than logging directly. Subscribe from application code to get structured observability.

- **`events.ts`** — exports `mochiEvents: Emitter<MochiEventMap>` plus event payload types:
  - `request` — any HTTP request (page or api): `{ kind, method, path, status, duration }`
  - `ws:open` / `ws:message` / `ws:close`
  - `sse:open` / `sse:message` / `sse:close`

  `Mochi.ts` is the sole emitter — search for `mochiEvents.emit(` to see the emission sites.

- **`consoleLogger.ts`** — opt-in event-to-console formatter. Call `consoleLogger()` once at startup (typically subscribed automatically by `Mochi.serve`) to print one formatted line per HTTP request, WS frame, SSE message, BOOT/STOP, and (with `cache: 'verbose'`) cache reads. Configurable via `{ level, slowThreshold, verySlowThreshold, cache }`; slow or 5xx lines go through `log.warn`. Calling it multiple times is a no-op.
- **`log.ts`** — the level-gated isomorphic logger primitive. Exports `log` (`error`/`warn`/`info`/`log` methods), `setLogLevel`, `getLogLevel`, and `LogLevel`. Framework code uses `log.*` instead of bare `console.*`; the same import works server-side, in SSR, in hydrated Svelte, and in web components.

To add a new event: add the payload type + key to `MochiEventMap` in `events.ts`, emit from `Mochi.ts`, re-export the payload type from `index.ts`, and subscribe in `consoleLogger.ts` if it should be logged.

### Adding framework errors visible to the client

1. Push errors to `this.errors` in `ComponentRegistry`.
2. The page render path checks `registry.getErrors()` before each render and throws `MochiHttpError(500, …)` if any are present. The thrown error routes through `routeErrorResponse` and renders the configured `errorPage` (default: `DefaultError.svelte`) with the formatted compile errors in `error.message`.

Error-boundary scope is **islands-only**: the preprocessor auto-wraps `mochi:hydrate*` islands in `<svelte:boundary>`, but does NOT auto-wrap pages. An uncaught top-level SSR throw must fall through to the route-handler try/catch and render the configured `errorPage` — don't add page auto-wrappers (they'd convert a hard-fail into a silent stub). Users author their own `<svelte:boundary>` when they want to gracefully degrade a portion of a page.

## Releases

This repo uses [release-please](https://github.com/googleapis/release-please) with Conventional Commits:

- `feat:` → minor, `fix:` / `perf:` → patch, `feat!:` or `BREAKING CHANGE:` footer → major.
- `chore:` / `docs:` / `refactor:` / `test:` / `ci:` / `build:` do not produce a release.

On push to `main`, a `chore(main): release mochi-framework` PR is opened/updated. Merging it tags, releases, and publishes `mochi-framework` to npm with provenance. Non-conforming commits are ignored (no enforcement).

See `CONTRIBUTING.md` for the one-time npm token / branch protection setup.

## Bun APIs

Default to Bun instead of Node.js:

- `Bun.serve()` for HTTP/WebSocket — not `express`.
- `bun:sqlite` for SQLite — not `better-sqlite3`.
- `Bun.file` over `node:fs` readFile/writeFile.
- Bun auto-loads `.env` — don't add `dotenv`.

## PostgreSQL (dev container)

A PostgreSQL 15 server runs by default inside the dev container for building Postgres-based features — started on each boot by `.devcontainer/start-postgres.sh` (Debian cluster tooling: `sudo pg_lsclusters`, `sudo pg_ctlcluster 15 main {start,stop,status}`).

- **In-container**: connect at `postgres://postgres:postgres@localhost:5432/postgres`. That URL is already exported as `DATABASE_URL` (plus `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`), so bare `psql` connects with no args and apps read `process.env.DATABASE_URL` — Bun's `bun:sql` picks it up automatically (`import { sql } from 'bun'`).
- **Credentials**: user `postgres`, password `postgres`, database `postgres`, port `5432`.
- **Host GUI** (TablePlus/DBeaver, from your machine): `127.0.0.1:8045`, same `postgres`/`postgres` credentials.
- **Ephemeral**: data survives container restarts but is reset on a full rebuild — recreate schema via migrations.
- **Tests don't use this server.** The suite runs against in-process PGlite (`packages/mochi/src/__fixtures__/postgres/startTestPostgres.ts`); never point a test at `localhost:5432`.

## Dependencies

- **Avoid the SSR build's `external` list.** When a dep won't bundle in `ComponentRegistry.ts`'s `Bun.build`, swap it for a cleanly-packaged (ideally CJS) alternative rather than externalizing — `external` deps must resolve at runtime from the consumer's compiled-chunk location, which is fragile across `workspace:*` packages. Concrete precedent: `@msgpack/msgpack` (unbundleable) → `@ably/msgpack-js` (bundles clean, same byte output). Externalizing "fixed" the build but broke `mochi-minimal` at runtime.
- **Vendoring** a library with separate Node/browser builds: combine both into a single ESM TS file switching at runtime via `typeof process !== 'undefined'` (the only safe strict-ESM global probe) — do NOT preserve its `package.json` `browser`-field remap (bundler-field remaps fragment behavior across Bun server / browser / SSR / hydrated client). Keep the upstream `LICENSE`, drop the npm dep, and delete the verbatim originals.

## Docker

The runtime is **colima**, usually stopped — start it before building:

```sh
colima start            # only if `colima status` says not running
docker build ...
```

Build targets default to `WORKSPACE=site` (override `--build-arg WORKSPACE=demos`): `Dockerfile` = dev-mode image (the variant deployed for site + demos, site ≈ 423 MB); `Dockerfile.production` = prebuilt SSR + `--omit=dev` (site ≈ 294 MB), used to deploy `packages/support` and by `docker-shell.sh` for `minimal`. `.github/workflows/build.yml` picks between them per matrix leg via a `dockerfile` field. Both `Dockerfile` and `Dockerfile.production` carry a `HEALTHCHECK` that probes the bare `/health` — it is a `Mochi.api()` route, so `trailingSlash: 'always'` never applies and `/health/` is a hard 404; every workspace built from either — site, demos, support, and `minimal` — serves a `/health` route so the probe passes. A bad cached `install` layer can fail a prod build with a misleading `Could not read .../index.ts` parse error — a `--no-cache` rebuild fixes it; reproduce in a clean container before blaming source.

## Hydration notes

- Hydration is all-or-nothing per island: `mochi:hydrate` hydrates the entire subtree together, no per-child opt-in.
- Islands do not receive an id prop. For a unique, SSR-stable id inside any component (e.g. for `<label for>`), use Svelte's native `const uid = $props.id();`. Server-island renders are namespaced via render's `idPrefix` (derived from the wrapper's `island-id`), so their ids never collide with the host page.
- To branch SSR-only fallback logic on whether the current render will hydrate, call `isHydratable()` (imported from `mochi-framework`, during component init like `getContext`) — it works at any nesting depth inside an island subtree, and is a constant `true` in client bundles. The signal is Svelte context seeded by a framework boundary component the preprocessor wraps around `mochi:hydrate*` call sites (`islands/HydratableBoundary.svelte`); also-hydrate server islands get it via `render({ context })` at the island endpoint. No prop is involved anywhere — user scripts are never touched, so island roots work in any script mode (runes, legacy, or ambiguous).
- A top-level read in a `mochi:hydrate*` island runs on the server during SSR **and again on the client during hydration** — there's no automatic SSR-value carryover. If it reads something the client can't see (e.g. `cookies.get()` against an `HttpOnly` cookie via `document.cookie`), the value flips to `(not set)` after hydration. To display a server snapshot, wrap the read in Svelte's `hydratable(key, fn)` (imported from `svelte`, not mochi; namespace the key, e.g. `mochi-demo:cookies-ssr`) — the server result is devalue-serialized into the page and reused client-side. See `packages/site/src/demos/cookies/CookieDemo.svelte`.
- Never write a literal `</script>` inside a `.svelte` `<script>` block — even in a `// comment`, JSDoc, or string literal, it closes the tag at the HTML-parsing layer before TypeScript sees it and yields a misleading `js_parse_error: Unexpected token` at line `:0`. Break it (`script` + `>` separately). If you hit that error at line 0 right after editing a `.svelte` file, search the script block for `</script` first.

## Conventions

- When moving components or other files, use `git mv` to preserve history.
- **Any path interpolated into a user-facing string** (error message, log line, stats/report entry) or into generated module source **must go through `toPosixPath()` / `relForDisplay()`** from `packages/mochi/src/utils/index.ts` — bare `path.relative()`/native paths render with backslashes on Windows and break both users' output and tests. Tests then assert plain forward-slash paths (never `path.sep` gymnastics) plus a `.not.toContain('\\')` guard where practical. Native separators stay only in filesystem logic (`startsWith(dir + path.sep)` containment checks and the like). Glob matching against user-authored patterns also needs POSIX-ified inputs — patterns are written with `/`.
- After completing your work, run `bun run checks` (which runs lint:fix + format + typecheck + test) instead of running those steps individually. **From the main context, delegate this to a Sonnet-based sub-agent** (e.g. via the `Agent` tool) that runs the command and reports back only the pass/fail status plus any failures — never run `bun run checks` directly in the main context, since its multi-thousand-line lint/typecheck/test output will pollute your conversation window. **Whenever running the test suite (`bun run test`) or `bun run checks`, set a 10-minute timeout (`600000` ms) in Claude Code** — the suite can be slow and anything shorter can time the job out mid-run.
- Before adding a new dependency, look up its latest version with `bun info <pkg> version` and pin to that — don't guess from training data, which is often months stale.
- For every new framework feature, add a short, to-the-point section (or sub-section in an existing page) under `packages/docs/`. Match the terse, code-first style of the existing pages. For warnings/notes/danger boxes inside docs, use `packages/docs/_components/Callout.svelte` (`type="info" | "warning" | "danger"`) — import it via a `<script>` block at the top of the markdown file. See `145-cache.md` for an example. **Always leave a blank line after `<Callout …>` and before `</Callout>`** — without them the block is raw HTML passed straight to the Svelte compiler: backticks aren't processed, so `` `{foo}` `` becomes a Svelte expression (SSR `ReferenceError`) and `` `<Image>` `` an unclosed tag (build failure). Same trap for any raw-HTML block in docs markdown: braces/tags outside fenced code or (markdown-processed) inline backticks reach the compiler.
- When documenting an API that is **not yet released** (it exists on `main`/HEAD but not in the published npm version), mark it with `packages/docs/_components/VersionNote.svelte`: `<VersionNote since="<next-version>" message="…" />`, imported via the page's `<script>` block. It renders a warning while the reader's installed `mochi-framework` is older than `since`, and a quiet "Available since" line afterwards. Place it directly under the page's `##` title for a whole-page-new API (see `115-queues.md`), or directly under the `###`/`####` heading of the specific section for one new sub-feature on an otherwise-released page (see the `.server.svelte` section of `73-server-only-imports.md` and `serverIsland:inlineBudget` in `162-extensions.md`). Section scope matters: don't page-flag a page whose rest is released. `VersionNote` reads the version from `mochi-framework/package.json`, so bump `since` to the release the feature actually ships in.
- Every demo in `packages/site/src/demos/` must have its own distinct icon. When you add a demo, also add a `demoIconFor` entry in `packages/site/src/lib/demoIcons.ts` — pick a Lucide icon that hasn't been used yet and that visually evokes the demo's concept.
- After non-trivial changes, run a smoke test of the demo site to catch runtime regressions with `bun run dev:site` (or `bun run start`), which serves the main site on port `3333`. Hit a couple of routes (e.g. `curl -sS http://localhost:3333/`) and then stop the server. Always request routes with a trailing slash (e.g. `/docs/`, not `/docs`) — `packages/site`, where we commonly work, sets `trailingSlash: 'always'`, so a slashless path just 308-redirects. Tear it down with `pkill -f dev:site` (or `pkill -f "src/index.ts"`), not by killing the port — `bun run` fans into a 3-process tree and killing only the port listener orphans the two wrappers, which pile up across runs; verify with `pgrep -x bun`.
- **Never auto-commit.** Don't run `git commit` (or `git add` + `commit`) on your own, even after a feature is "done". Finish, run checks/format (delegated), report what changed, and wait for an explicit "commit" / "/commit" / "make a PR". `git push` and PR creation are equally gated. Read-only git inspection (status/diff/log) is fine.
- **Debug empirically, with a minimal reproduction.** Never claim a bug's root cause from reading code/comments — reproduce it first with a small standalone script that strips everything except the triggering conditions, then diagnose. Code comments describe workarounds for a specific context, not proof the same issue applies elsewhere.
- **Validate in the browser with the `chrome-devtools` MCP.** `curl` only exercises the SSR HTML — for anything involving hydration, islands, client-side JS, or interaction, drive a real browser against the dev server (start one as above with `bun run dev:site` on port `3333`). Useful tools: `navigate_page` to load a route, `list_console_messages` to catch JS console errors/warnings (hydration mismatches, uncaught exceptions), `list_network_requests` to spot failed island/asset fetches (e.g. `/_mochi/island/*` 500s), `take_snapshot` to inspect the live DOM, `click`/`fill`/`fill_form` to exercise interactions, and `take_screenshot` for visual confirmation. Always check the console for errors after loading a page — a clean SSR response can still throw on hydration.
- For framework-internal self-requests (warmup, prerender, self-checks), invoke the route handler in-process with a synthetic `Request` + the real `server` object — don't `fetch()` the loopback server (avoids the network hop and `0.0.0.0` resolution quirks). Watch trailing-slash policy: request the canonical path or `buildRequestContext` early-returns a 301/308. New behaviors like this should be an opt-in `Mochi.serve()` option (default `false`).
- Build demos to do **exactly** what was asked — nothing decorative.
- A demo's source file list is the single source of truth in `packages/site/src/demos/<slug>/files.ts` (`files: SourceSpec[]`, paths relative to the site root, including cross-folder files like `./src/demoIndex.ts`). It's consumed by the demo entry `.svelte` (`loadSources(files)`) and by the `/demos/<slug>/llms.txt` route via the registry `packages/site/src/lib/demoFiles.ts`. When adding a demo, create its `files.ts`, import it in the entry, and add an entry to `lib/demoFiles.ts` — don't scan/parse the folder.

## Icons (Lucide)

Use `@lucide/svelte`. Always import each icon from its per-icon path so the rest of the set is tree-shaken — never barrel-import:

```ts
import Sun from '@lucide/svelte/icons/sun'; // ✅
import { Sun } from '@lucide/svelte'; // ❌ pulls the whole set
```

For non-Svelte contexts (e.g. HTML strings in `highlight.ts`), inline the icon's SVG markup directly rather than reaching for a runtime renderer.

## Comments

Use code comments sparingly, this is important.

- Comment the **why**, never the **what** — the code already says what it does, and a comment that restates it just rots. Prefer no comment to an obvious one.
- **One sentence.** Allow a second only when the why is genuinely incomprehensible without it (a non-obvious constraint, a bug being worked around, an ordering dependency between two calls); never a third. A comment that keeps growing usually means the code needs a better name or a smaller function, not more prose.
- Do not add comment signatures for new functions unless you need to explain WHY the function is needed.
- Do not add comments for CSS - ever!
- Do not add comments to simple functions.
- Never write a literal `</script>` inside a `.svelte` `<script>` block — including in a comment; it closes the tag at the HTML-parsing layer and yields a misleading `js_parse_error` at line `:0`. Break it up (`script` + `>` separately).

## After every change

Run `bun run format` — but **delegate it to a sub-agent** from the main context, same rule as `bun run checks` above (including the exception: if you are already a sub-agent, run it directly rather than nesting another sub-agent). The agent runs the command and reports back only the status (pass / fail + any errors); the main context should never see the per-file "unchanged / formatted" listing.
