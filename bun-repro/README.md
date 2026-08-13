# Bun bundler segfault: plugin declines a CSS `url()` asset Bun would copy

A bundler plugin whose `onLoad` returns `undefined` (declining the file, so Bun loads it normally) segfaults the CSS
bundler when the asset is one Bun copies to a file instead of base64-inlining.

The cutoff is `COPY_THRESHOLD` in `add_url_for_css`, hardcoded at 128 KB: below it the asset is inlined and the build
succeeds, at or above it the process dies.

## Run

```sh
bun run repro.ts small   # 21,168 B  -> success: true | outputs: small.css
bun run repro.ts         # 149,720 B -> panic: Segmentation fault at address 0xAAAAAAAAAAAAAAAE
```

Both stylesheets are identical apart from which font they reference. The fonts are `@fontsource` woff2 files
(`jetbrains-mono-latin-400-normal` and `fraunces-latin-full-italic`); any two files either side of 128 KB reproduce it,
including files of random bytes — only the size matters. The exact boundary is 131071 B (ok) vs 131072 B (crash).

Removing the plugin makes the large case succeed: Bun copies the font to `.out/big-<hash>.woff2` and rewrites the
`url()` to point at it. The crash needs a plugin that matches the file and declines it.

## Environment

- Bun 1.3.14 (0d9b296a), macOS 26.6.1, arm64.
- No dependencies; `repro.ts` only calls `Bun.build`.

## Why it matters

Declining a file is how a plugin says "this one is not mine" — a plugin that intercepts only some fonts, or only fonts
over a size limit, has to return `undefined` for the rest. Today that is a crash rather than a fallthrough whenever one
of those files is large enough for Bun's copy path.

Related, on the threshold itself: https://github.com/oven-sh/bun/issues/24599
