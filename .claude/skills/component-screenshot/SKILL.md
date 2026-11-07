---
name: component-screenshot
description: Take a 16:9 screenshot of a single component via the /shot/:name endpoint (`packages/site/src/shot/`). Use when the user asks to "screenshot a component", "take a component screenshot", "generate an image of <component>", "grab a shot of X for the docs", or "/component-screenshot <component>". Covers registering a new subject, sizing, and driving the browser.
user-invocable: true
---

# Take a component screenshot

`/shot/:name` renders one component alone on a bare canvas — no nav, no `DemoPage` chrome, no dev toolbar — so the browser can photograph it. Defaults to 1280x720.

The route returns HTML, not an image — something has to photograph it. Two ways:

- **`scripts/shoot.ts`** (preferred) — a committed script driving `Bun.WebView`. It boots its own dev server, sizes the viewport, measures the render and refuses to save a bad shot. Repeatable, scriptable, and usable in CI.
- **The chrome-devtools MCP** — for interactive work, when you want to poke at the page between steps.

```sh
bun --cwd=packages/site scripts/shoot.ts captcha --out shot.png
bun --cwd=packages/site scripts/shoot.ts like --w 1280 --h 360 --theme minimal
```

The script exits non-zero and explains itself rather than writing a wrong image: it checks the viewport matches the requested frame, that the subject is centred, that it fills ~90% of the limiting axis (a miss means `natural` in the registry is wrong), that the island hydrated, and that the console stayed clean. Flags: `--out`, `--w`, `--h`, `--scheme`, `--theme`, `--base` (shoot an already-running server), `--keep-open`.

Glyph coverage still depends on the fonts installed where it runs — a container without an emoji or icon font renders tofu boxes, the same constraint `scripts/bake-og-assets.ts` documents. Check the saved image, don't just trust the exit code.

The rest of this page is the MCP path, and the registry/`natural`/verification guidance that applies to both.

## The endpoint

Request it **with a trailing slash** — `packages/site` sets `trailingSlash: 'always'`, so `/shot/captcha` just 308s.

| Param          | Meaning                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `?w=`          | Frame width, default `1280`. Height follows 16:9 unless `?h=` is given, so `?w=1920` → 1080.                       |
| `?h=`          | Frame height. Use it for a doc banner (`?h=360`) — a 720-tall frame is mostly dead space around a short component. |
| `?scheme=`     | `light` (default) or `dark`. Pinned via a handle in `shot/routes.ts`, wired into `sequence()` in `src/index.ts`.   |
| subject params | Per-subject, resolved in `registry.ts` (e.g. the captcha's `?theme=defaults\|themed\|candy\|terminal`).            |

Files:

- `packages/site/src/shot/registry.ts` — subject names, prop resolvers, natural sizes, `frameSize()`, `fitScale()`.
- `packages/site/src/shot/Shot.svelte` — the frame; one `{#if}` branch per subject.
- `packages/site/src/shot/subjects/` — thin wrappers, only for components that need one (see below).
- `packages/site/src/shot/routes.ts` — the route + the scheme-pinning handle.

## Steps

1. **Is the subject already registered?** Check `subjects` in `registry.ts`. If yes, skip to step 5. `/shot/nope/` 404s with the known names.

2. **Decide whether it needs a wrapper.** This is the one real trap. The island preprocessor honours `mochi:hydrate` **only** on a single default import from a `.svelte` path — every other import form is silently ignored and the component renders inert (see `BUG_REPORT.md`).

   - Already `import Foo from './Foo.svelte'` → **no wrapper**, hydrate it directly in `Shot.svelte` (that's what `LikeButton` does).
   - Anything else — a package export like `import { MochiCaptcha } from 'mochi-framework/components'`, a named import, a mixed `import Foo, { BAR } from './Foo.svelte'` → **needs a thin wrapper** under `subjects/` that the frame hydrates instead. `subjects/CaptchaShot.svelte` is the reference.

   The wrapper must not set its own width — the frame sizes it from `natural` — so use `width: 100%`.

3. **Add the registry entry:**

   ```ts
   like: {
     natural: { width: 31, height: 19 },
     props: () => ({ initialLikes: 42 }),
   },
   ```

   `props` is resolved server-side per request (same contract as a page's `serverProps`) and receives the `URL`, so read query params there and `error(400, …)` on a bad value. Mint anything server-only here (`mintCaptcha()`).

4. **Add the branch** in `Shot.svelte` — a branch, not a dynamic `<Subject />`, for the same preprocessor reason as step 2:

   ```svelte
   {:else if name === 'like'}
     <LikeButton mochi:hydrate {...(props as ComponentProps<typeof LikeButton>)} />
   ```

5. **Start a dev server on a free port.** The user usually has `bun run dev` on 3333–3336; pick something else and check it's free first, or you'll get `EADDRINUSE`:

   ```sh
   for p in 4455 4466 4477; do lsof -ti tcp:$p >/dev/null 2>&1 || { echo "FREE:$p"; break; }; done
   PORT=4455 MOCHI_PORT=4455 nohup bun run dev:site > /tmp/shot-dev.log 2>&1 &
   for i in $(seq 1 90); do grep -qE "Server running at|EADDRINUSE" /tmp/shot-dev.log && break; sleep 1; done
   ```

   Edits under `shot/` hot-reload. Edits to `src/index.ts` (e.g. the handle wiring) need a **restart** — the handle silently won't run otherwise.

6. **Set the viewport to exactly the frame size, then navigate.** `take_screenshot` captures the viewport, so a mismatch crops or letterboxes the shot:

   ```
   resize_page(width: 1280, height: 720)
   navigate_page("http://localhost:4455/shot/captcha/")
   ```

7. **Verify before capturing** (see below), then `take_screenshot({ filePath: "…" })`.

8. **Stop only your own server.** Never blanket-kill bun — the user's fleet is probably running:

   ```sh
   lsof -ti tcp:4455 | xargs -r kill -9
   ```

## Getting `natural` right

`natural` is the subject's unscaled CSS-pixel box. The frame scales it by `fitScale()` = the largest uniform scale that still fits, times `FILL` (0.9). **Uniform** — it never stretches, because a subject whose aspect ratio isn't the frame's (the captcha is ~9.5:1 against 16:9) would distort.

A wrong `natural` doesn't error; it just mis-scales, so don't guess it:

- **Wrapper with `width: 100%`** → the subject fills the box exactly, so `natural.width` is whatever you choose (416 for the captcha). Only the height must be real (the captcha track is 44px in `MochiCaptcha`'s own CSS).
- **No wrapper** → the component's intrinsic size governs. Put a placeholder in the registry, load the page, and back the true value out of the render with `subjectBox()` below:

  ```js
  () => {
    const fit = document.querySelector('.fit');
    const b = subjectBox(fit);
    const scale = +getComputedStyle(fit).transform.match(/matrix\(([\d.]+)/)[1];
    return { width: +(b.width / scale).toFixed(1), height: +(b.height / scale).toFixed(1) };
  };
  ```

  Then write that into `natural` and reload — a correct value reproduces itself (declare 416x44, measure 416x44). A guessed 120x34 for `LikeButton` was really 31x19: it rendered off-centre and under-filled.

## Verification

Never trust the shot without measuring it. Equal gaps prove centring; the island wrapper proves it isn't inert HTML.

`.fit`'s own box is the _unscaled_ natural box, and its `firstElementChild` is a Svelte-injected `<script>` (0x0) — so measure the union of the rendered descendants instead. `subjectBox()` is the reusable half:

```js
() => {
  // The subject's true visual box: union of every descendant that actually renders.
  const subjectBox = (fit) => {
    const rects = [...fit.querySelectorAll('*')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  };

  const shot = document.querySelector('.shot').getBoundingClientRect();
  const b = subjectBox(document.querySelector('.fit'));
  return {
    frame: { w: shot.width, h: shot.height },
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    gapLeft: +(b.left - shot.left).toFixed(1),
    gapRight: +(shot.right - b.right).toFixed(1),
    gapTop: +(b.top - shot.top).toFixed(1),
    gapBottom: +(shot.bottom - b.bottom).toFixed(1),
    pctW: +((b.width / shot.width) * 100).toFixed(1),
    pctH: +((b.height / shot.height) * 100).toFixed(1),
    hydrated: !!document.querySelector('mochi-hydratable-island'),
  };
};
```

Expect: `frame` == `viewport` == the requested size, left/right and top/bottom gaps equal (sub-pixel rounding is fine), `pctW` near 90 on the limiting axis, `hydrated: true`. Also check `list_console_messages` — a clean SSR response can still throw on hydration.

If `hydrated` is false, you hit step 2's trap; re-read `BUG_REPORT.md` rather than debugging the CSS.

Then confirm the saved file is real, since the MCP reports success either way:

```sh
file shot.png   # → PNG image data, 1280 x 720
```

## Using a shot in the docs

Save under `packages/site/public/docs/<name>.png` and reference it `/docs/<name>.png`. `.readme :global(img)` in `packages/site/src/Docs.svelte` holds it to the prose column — without it a 1280-wide image overflows. For a caption use `<figure>`/`<figcaption>` (raw HTML survives mdsvex); `.readme :global(figcaption)` styles it.

Prefer a banner aspect (`?h=360`) for docs. Note a shot is pinned to one scheme, so a light image sits bright on the dark docs theme — call that out rather than silently shipping it.

## Guardrails

- **The endpoint returns HTML, not PNG.** Don't add `puppeteer`/`playwright` — `Bun.WebView` is built into the runtime and `scripts/shoot.ts` already uses it.
- **Don't reach for a dynamic `<Subject />` component map.** It renders SSR-only and never hydrates. The `{#if}` chain is load-bearing, not clumsiness.
- **Don't unpin the scheme.** `?scheme` defaults to `light` so a URL yields the same image on every machine; dropping it lets the screenshotting machine's OS dark mode leak into the canvas.
- **Don't `error()` from the handle.** A throw there is a 500, not a 400 — validate in `serverProps` and keep `readScheme()` non-throwing for the handle.
- **Don't blanket `pkill -f bun`** or kill Chrome the user is using. If the MCP reports "browser is already running" for `chrome-devtools-mcp/chrome-profile`, that profile is the MCP's own — `pkill -9 -f "chrome-devtools-mcp/chrome-profile"` and remove the stale `SingletonLock`/`SingletonSocket`/`SingletonCookie` symlinks, then retry.
- **Run `bun run checks`** (delegated to a sub-agent) after registry/Shot edits, and **never commit** — report and wait.
