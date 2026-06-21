# msgpackr-extract (stub)

This is **not** the real [`msgpackr-extract`](https://www.npmjs.com/package/msgpackr-extract).
It's a local empty stub that exists only to be substituted for it via the root
`package.json` `overrides` field:

```jsonc
"overrides": { "msgpackr-extract": "workspace:*" }
```

`msgpackr` (pulled in transitively by `bunqueue`) lists `msgpackr-extract` as an
**optional** dependency — a native C++ accelerator that also drags in
platform-specific `@msgpackr-extract/*` prebuilt binaries. We don't want those
binaries in the install, so we replace the package with this stub.

`index.cjs` exports a falsy value, which mirrors the "native module not present"
path inside `msgpackr` (its `require` is wrapped in try/catch and guarded by
`if (extractor)`). The result is that `msgpackr` runs on its pure-JS codec, and
no native binaries are downloaded.
