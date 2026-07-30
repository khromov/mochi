---
name: add-library-demo
description: Add a demo to the Mochi site (`packages/site`) that showcases a third-party library (usually a Svelte 5 / runes library like Runed) running inside islands. Use when the user asks to "add a demo for <library>", "demo <library> in Mochi", "show <library> off", or "/add-library-demo <library>".
user-invocable: true
---

# Add a third-party-library demo

Build one demo folder that exercises the interesting parts of a library across one or more `mochi:hydrate` islands, then wire it into the four registration points. Most such libraries are browser-driven, so this is a hydration showcase: the page renders on the server with default values, then the library comes alive on the client.

## Intro text — always three things

The demo's intro (a `<p>`/`<div>` at the top of the `DemoPage` **body**, not the `description` prop — that prop is escaped plain text and also feeds SEO meta) must state:

1. **Setup.** If the library needs nothing special, say so plainly (e.g. "needs no special setup — it's a plain Svelte 5 runes library, so you install it and import from `<lib>`; in Mochi it bundles straight into whichever island imports it"). If it _does_ need config/a plugin/a provider, describe that instead — don't claim zero-setup unless it's true.
2. **A basic install/usage code example.** At minimum an install line in a `<pre><code>bun add <lib></code></pre>` block; a tiny usage snippet is even better.
3. **A link to the library's website**, `target="_blank" rel="noopener noreferrer"` (matches the site's outbound-link convention).

## Steps

1. **Pin the version, then add the dep:** `bun info <lib> version`, then `bun add <lib> --cwd packages/site`. This is likely the first third-party _runtime_ library bundled into an island — that's fine, but see the browser check below.

2. **Create `packages/site/src/demos/<slug>/`** — model on `demos/cookies/` and `demos/hydration/`:
   - Entry `<Name>.svelte`: wrap in `<DemoPage title description {sources}>`, `const sources = await loadSources(files)`, place each island with `mochi:hydrate`. Group by theme — one island component per themed card reads better than one giant island.
   - Island component(s): `<script lang="ts">`, import from `<lib>`, scoped `<style>` using the site CSS custom properties (`--surface`, `--border`, `--text`, `--accent`, `--font-mono`, `--code-bg`, badge tokens…). Reuse `components/Badge.svelte` for status pills. Element-ref utilities need `$state()` + `bind:this` passed as a getter `() => el`.
   - `routes.ts`: `'/demos/<slug>': Mochi.page('./src/demos/<slug>/<Name>.svelte')` plus any backing `Mochi.api` the demo needs.
   - `files.ts`: `SourceSpec[]` listing every source, ending with `{ label: 'index.ts', path: './src/demoIndex.ts' }` (verbatim, like every demo).

3. **Wire the four registration points** (`demoRegistry.test.ts` enforces they stay consistent):
   - `src/routes.ts` — `import { routes as <x>Routes } from './demos/<slug>/routes';` + `...<x>Routes,`.
   - `src/lib/demos.ts` — `import { files as <x> } from '../demos/<slug>/files.ts';` + a `demos[]` entry `{ href: '/demos/<slug>/', slug, files, title, hook, category: 'hydration' }`.
   - `src/lib/demoIcons.ts` — import an **unused** per-icon Lucide path and add `'<Title>': { icon, label }` to `demoIconFor` (keyed by title, not slug).
   - No `Site.svelte` edit — the landing page derives from the registry.

## Gotchas

- **API routes obey `trailingSlash: 'always'`.** A client `fetch('/api/<slug>/x')` 301/308-redirects; fetch the canonical `'/api/<slug>/x/'` directly.
- **SSR runs the island too.** Browser-only utilities are SSR-safe but return defaults (`0`/`false`/`undefined`) during SSR, then the top-level re-runs on the client during hydration — design each card so the SSR state reads as intended, not broken.
- **A class utility whose constructor synchronously touches the instance being assigned** (e.g. a `FiniteStateMachine` initial-state `_enter` that references the `const`) hits the temporal dead zone — defer the self-reference (`queueMicrotask`) and/or guard on `isBrowser`.

## Verify

- Start one site on a free port: `PORT=4444 bun run dev:site`. `curl` the page (trailing slash) for a 200 + the intro's install line/link.
- **Drive a real browser** (chrome-devtools MCP) against `/demos/<slug>/` — curl only exercises SSR. Confirm every island hydrates with **zero console errors/warnings** (this is the load-bearing check for a first-time island dependency), any backing `fetch` succeeds, and interactions work. Screenshot for a visual check.
- Tear down with `pkill -f dev:site` (verify `pgrep -x bun`).
- Delegate `bun run checks` + `bun run format` to a sub-agent (keep the output out of the main context). **Never commit** unless asked.
