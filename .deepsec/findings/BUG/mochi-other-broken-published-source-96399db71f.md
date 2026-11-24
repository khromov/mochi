# [BUG] Published demo source omits the `markdown` serve option the demo depends on

**File:** [`packages/site/src/demos/mdsvex/files.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/mdsvex/files.ts#L8) (lines 8)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-broken-published-source`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The mdsvex demo publishes `./src/demoIndex.ts` as its `index.ts` (line 8), but `demoIndex.ts` configures only `staticDirs` and `image` — it has no `markdown:` block. The framework is explicit that this makes the demo impossible to reproduce: `packages/mochi/src/compiler/ComponentRegistry.ts:332` documents the option as "User-injected markdown integration. When unset, `.md`/`.svx` imports are not handled", and `packages/docs/158-mdsvex.md:149` confirms "Omitting the `markdown` config disables `.md`/`.svx` handling, so importing one surfaces a 'no loader' error from Bun's bundler." The demo's own `Greeting.md` / `Snippet.svx` imports therefore cannot compile from the published set. The repo already has the mechanism for exactly this case and every comparable demo uses it: `demos/image/files.ts` passes `showImageConfig: true`, `demos/static-dirs/files.ts` passes `showStaticDirs: true`, and protection/queue/varlock publish dedicated index files (`protectionIndex.ts`, `queue/index.ts`, `varlock/index.ts`). mdsvex is the one demo whose subject *is* a `Mochi.serve()` option and it publishes the stripped generic index. Blast radius is wider than the demo page tab, because this same list is the single source of truth for `/demos/mdsvex/llms.txt`, the `/llms-full.txt` bundle, and the MCP `get_section({type:'demo',slug:'mdsvex'})` tool (`lib/docs.ts:212-247`) — an agent reading it is handed a complete-looking app that fails to build. No security impact; the human-facing docs page covers the option correctly.

## Recommendation

Add the `markdown:` block (compile + rehypePlugins + highlight) to `src/demoIndex.ts` behind a new opt-in flag mirroring the existing pattern — a `showMarkdownConfig` field on `SourceSpec` plus a `stripMarkdownConfig` default-strip in `components/sourceUtils.ts` and `lib/docs.ts:227-233` — then set `{ label: 'index.ts', path: './src/demoIndex.ts', showMarkdownConfig: true }` here. Alternatively publish a dedicated `./src/demos/mdsvex/mdsvexIndex.ts` the way the protection demo does.

## Revalidation

**Verdict:** true-positive

Every claim checks out. demos/mdsvex/files.ts:8 publishes `{ label: 'index.ts', path: './src/demoIndex.ts' }` with no opt-in flag, and demoIndex.ts contains only `port`, `staticDirs`, `image` and `routes` — no `markdown:` block (the real packages/site/src/index.ts:239 does pass `markdown: markdownConfig`, so the demo genuinely needs an option the published file omits). Worse, because the spec carries neither `showImageConfig` nor `showStaticDirs`, both `loadSources` (components/utils.ts:24-31) and `buildDemoLlmsTxt` (lib/docs.ts:228-234) strip the image and staticDirs blocks too, so the reader is handed a bare `Mochi.serve({ port, routes })`. Meanwhile MdsvexDemo.svelte imports `./Greeting.md` and `./Snippet.svx` directly, and the framework is explicit that this cannot work: ComponentRegistry.ts:332 documents "When unset, `.md`/`.svx` imports are not handled", and packages/docs/158-mdsvex.md:149 states omitting it "surfaces a 'no loader' error from Bun's bundler." The opt-in mechanism the recommendation proposes already exists and is used by exactly the comparable demos — `showImageConfig: true` in demos/image/files.ts, `showStaticDirs: true` in demos/static-dirs/files.ts — and protection/queue/varlock each ship a dedicated index file (protectionIndex.ts, queue/index.ts, varlock/index.ts). Blast radius is as described: the same `files` array is the single source of truth for the demo page and for `/demos/mdsvex/llms.txt` via `filesForDemo` → `buildDemoLlmsTxt` (lib/docs.ts:25, 212-247). One harmless inaccuracy: the registry is packages/site/src/lib/demos.ts (mdsvex entry at L378-385), not `lib/demoFiles.ts` as the finding says, echoing a stale path in CLAUDE.md. Documentation-correctness bug, no security impact; BUG is right.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-06-15)
