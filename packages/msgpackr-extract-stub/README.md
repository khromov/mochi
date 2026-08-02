# @mochi-framework/msgpackr-extract-stub

This is **not** the real [`msgpackr-extract`](https://www.npmjs.com/package/msgpackr-extract).
It's an empty stub meant to be substituted for it via a `package.json`
`overrides` field:

```jsonc
"overrides": { "msgpackr-extract": "npm:@mochi-framework/msgpackr-extract-stub@^0.0.1" }
```

`msgpackr` (wherever it appears in a dependency tree) lists `msgpackr-extract` as an
**optional** dependency — a native C++ accelerator that also drags in
platform-specific `@msgpackr-extract/*` prebuilt binaries. We don't want those
binaries in the install, so we replace the package with this stub.

`index.cjs` exports a falsy value, which mirrors the "native module not present"
path inside `msgpackr` (its `require` is wrapped in try/catch and guarded by
`if (extractor)`). The result is that `msgpackr` runs on its pure-JS codec, and
no native binaries are downloaded.
