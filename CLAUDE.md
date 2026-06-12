# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Bun workspaces monorepo:

- `packages/mochi` — the `mochi-framework` library (published to npm). All framework source lives here.
- `packages/site` — demo site that consumes `mochi-framework` via `workspace:*`.
- `packages/demos` — standalone demos site (HN clone today). Deployed separately from `packages/site`.

Root `package.json` scripts delegate into packages with `bun --cwd=packages/<name> run …`. Most framework work happens inside `packages/mochi/src/`; site/demo work lives in `packages/site/src/` and `packages/demos/src/`.

## Commands

```sh
bun run dev          # Run BOTH site (3333) and demos (3334) in parallel, MODE=development
bun run dev:site     # Just the main site
bun run dev:demos    # Just the demos site
bun run start        # Start the main site in production mode
bun run start:all    # Run both sites in production mode
bun run build        # Pre-build islands for site + demos (parallel via `bun --filter`)
bun run clean        # Remove .mochi/ in site + demos
bun run typecheck    # tsc --noEmit across all workspaces
bun run test         # Run tests across all workspaces (bun test)
bun run lint         # eslint . (ignores .mochi/, packages/site/.mochi/, .claude/)
bun run lint:fix     # eslint . --fix
bun run format       # prettier --write .
bun run format:check # prettier --check . (used by CI)
bun run loc          # Lines-of-code report for all packages (.github/scripts/loc-report.ts)
```

Multi-package scripts (`build`, `test`, `typecheck`, `clean`, `dev`, `start:all`) use `bun --filter='*' run <script>`, which fans out to every workspace, runs in topological order, and parallelises siblings.

Run a single test file: `bun test packages/mochi/src/forms.test.ts` (or pass `-t <pattern>` to filter).

### Testing: per-file isolation

Every test file runs in its own `bun test` process, up to `navigator.hardwareConcurrency` files in parallel. `packages/mochi/scripts/run-tests.ts` globs `src/**/*.test.ts`, spawns each file individually, and aggregates exit codes. This avoids Bun bundler EISDIR bugs when compiling the same Svelte entrypoint twice, `globalThis.__mochi_config__` conflicts from multiple `Mochi.serve()` calls, and `GlobalRegistrator` pollution. Parallelism is safe because every test uses unique temp dirs (`mkdtempSync`) and `port: 0`.

## Architecture

Mochi is an experimental SSR framework for Svelte 5 + Bun with islands-based selective hydration. Components render server-side on every request; only components marked with `mochi:hydrate*` or `mochi:defer` ship JavaScript to the browser.

### Framework entry points (`packages/mochi/src/`)

- **`Mochi.ts`** — `Mochi.serve()` starts the Bun server. Route types:
  - `Mochi.page(path, { serverProps?, actions? })` — SSR Svelte page. `serverProps` is an object or `(req, params) => props` resolver. `actions` is a `MochiFormActions` map used for POST form submissions (see `forms.ts`).
  - `Mochi.api(handler)` — JSON API route with automatic `MochiHttpError` handling.
  - `Mochi.ws(handlers)` — WebSocket route (`upgrade`/`open`/`message`/`close`/`drain`).
  - `Mochi.sse(handler)` — Server-Sent Events stream (`send`/`close`/`onClose`).
- **`ComponentRegistry.ts`** — SSR compilation of `.svelte` via Svelte 5; preprocesses `mochi:hydrate`, `mochi:hydrate:visible`, `mochi:defer`, `mochi:defer:visible`; builds client bundles only for hydratable components; exposes the virtual `mochi` module (`isServer`, `isBrowser`, `isDev`).
- **`hooks.ts`** — SvelteKit-style middleware. `Handle` receives `{ event, resolve }`. `sequence(...)` composes handles. `resolve(event, opts)` accepts `transformPage` / `filterResponseHeaders`.
- **`requestContext.ts`** — `getRequestContext()` returns `{ request, url, params, locals, cookies, form? }` via `AsyncLocalStorage`. Available in any server-side code (components, API handlers, server islands). The `AsyncLocalStorage` instance is pinned on `globalThis` so multiple bundled copies share state.
- **`forms.ts`** — `fail(status, data)`, `redirect(status, location)`, `success(data?)` return values from a `Mochi.page` action. `fail`/`success` re-render the page with a `form` prop; `redirect` issues the redirect response. A page route may not return its own `form` prop if it declares actions (reserved name).
- **`cookies.ts`** — `MochiCookieJar` on the request context. `cookies.get/set/delete` with `CookieSerializeOptions`.
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

## Hydration notes

- Hydration is all-or-nothing per island: `mochi:hydrate` hydrates the entire subtree together, no per-child opt-in.
- All island components (`mochi:hydrate`, `mochi:hydrate:visible`, `mochi:defer`, `mochi:defer:visible`) implicitly receive an `islandId` prop matching the wrapper's `island-id` attribute. Accept it with `let { islandId } = $props()` if needed.
- Hydratable invocations (`mochi:hydrate`, `mochi:hydrate:visible`, `mochi:defer`, `mochi:defer:visible`, `mochi:defer mochi:hydrate`) also implicitly receive `isHydratable: true` as a prop; pure SSR-only invocations leave it undefined. Use it to branch SSR-only fallback logic at the same call site that hydrates client-side: `let { isHydratable }: { isHydratable?: boolean } = $props()`.

## Conventions

- When moving components or other files, use `git mv` to preserve history.
- After completing your work, run `bun run checks` (which runs lint:fix + format + typecheck + test) instead of running those steps individually. **Always delegate this to a sub-agent** (e.g. via the `Agent` tool) that runs the command and reports back only the pass/fail status plus any failures — never run `bun run checks` directly in the main context, since its multi-thousand-line lint/typecheck/test output will pollute your conversation window.
- Before adding a new dependency, look up its latest version with `bun info <pkg> version` and pin to that — don't guess from training data, which is often months stale.
- For every new framework feature, add a short, to-the-point section (or sub-section in an existing page) under `packages/docs/`. Match the terse, code-first style of the existing pages. For warnings/notes/danger boxes inside docs, use `packages/docs/_components/Callout.svelte` (`type="info" | "warning" | "danger"`) — import it via a `<script>` block at the top of the markdown file. See `145-cache.md` for an example.
- Every demo in `packages/site/src/demos/` must have its own distinct icon. When you add a demo, also add a `demoIconFor` entry in `packages/site/src/lib/demoIcons.ts` — pick a Lucide icon that hasn't been used yet and that visually evokes the demo's concept.
- After non-trivial changes, run a smoke test of the demo site to catch runtime regressions. The user may already have `bun run dev` running (which fans out to ports `3333` + `3334` + `3335`), so use a single-site command on a different port to avoid collisions: `PORT=4444 bun run dev:site` (or `bun run start`). Hit a couple of routes (e.g. `curl -sS http://localhost:4444/`) and then stop the server.

## Icons (Lucide)

Use `@lucide/svelte`. Always import each icon from its per-icon path so the rest of the set is tree-shaken — never barrel-import:

```ts
import Sun from '@lucide/svelte/icons/sun'; // ✅
import { Sun } from '@lucide/svelte'; // ❌ pulls the whole set
```

For non-Svelte contexts (e.g. HTML strings in `highlight.ts`), inline the icon's SVG markup directly rather than reaching for a runtime renderer.

## Comments

Use code comments sparingly, this is important. Comments should explain WHY something is done, not what is being done. Do not add comment signatures for new functions unless you need to explain WHY the function is needed.

## After every change

Run `bun run format` — but **delegate it to a sub-agent**, same rule as `bun run checks` above. The agent runs the command and reports back only the status (pass / fail + any errors); the main context should never see the per-file "unchanged / formatted" listing.
