# [BUG] The documented "cacheDir must NOT be under publicDir" constraint is never enforced, so a misconfiguration publishes cached originals

**File:** [`packages/mochi/src/image/config.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/image/config.ts#L91) (lines 91)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** low  •  **Slug:** `other-unenforced-config-constraint`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`types.ts:111` documents a hard constraint on this option — "Disk cache directory. Must NOT be under `publicDir`." — but `resolveImageOptions` simply takes `o.cacheDir ?? './.mochi/image-cache'` (L91) and no code anywhere in the framework compares it against `options.publicDir`. I grepped every `publicDir`/`cacheDir` site: `Mochi.ts:511` resolves `publicDir`, `Mochi.ts:1831` scans it into static routes, `cli/build.ts:127` scans it for route collisions — none of them is aware of `image.cacheDir`.

If an operator points `cacheDir` under `publicDir` (a plausible mistake when trying to let a CDN serve the cache directly), the startup `resolvePublicFiles` scan registers the cache's files as ordinary public static routes. `FileStorage` names entries `sha256(key)`, so they are not directory-listable, but the stored envelope deliberately keeps the *plaintext* cache key so `keys()` can enumerate it (`cache/cache-storage.ts:69,406`) — meaning each `.json` contains `MochiImage:Original:<plaintext src>` plus the entry metadata, and `offloadBinary: true` writes the raw original bytes to a sibling blob file. An attacker who guesses a candidate source URL can compute `sha256('MochiImage:Original:' + src)`, request that path, and both confirm the guess and retrieve the full original bytes — directly defeating the "the source URL stays hidden" guarantee that `packages/docs/148-images.md:17,262` names as the feature's security boundary, and bypassing the endpoint's `safeOriginalContentType` coercion (those bytes are then served by the static-file route under whatever type its extension implies).

This requires operator misconfiguration, but it is a constraint the project states as mandatory and validates nowhere — unlike the adjacent `staticDirs` mount check (`runtime/staticDirs.ts:20`), which does throw.

## Recommendation

Validate at boot: resolve both `image.cacheDir` and `publicDir` to absolute paths and throw from `Mochi.serve()` if the cache directory is inside (or equal to) `publicDir` or any `staticDirs` mount, mirroring the error style of `runtime/staticDirs.ts`. The same check belongs in `mochi-framework build` so the failure shows up before deploy.

## Revalidation

**Verdict:** true-positive

The factual core is confirmed. `types.ts:111` states the constraint as mandatory ('Disk cache directory. Must NOT be under `publicDir`.'), and a repo-wide grep for `cacheDir` returns only six non-test sites — `imageCache.ts:118/124/166`, `config.ts:91/128/141`, `types.ts:112/149` — none of which sees `publicDir`. Nothing in `Mochi.ts`, `runtime/publicDir.ts` or `cli/build.ts` compares the two, in stark contrast to `runtime/staticDirs.ts`, which throws on seven separate mount problems including a prefix inside the asset prefix. The disclosure mechanics also hold: `FileStorage` writes `<sha256(key)>.json` (cache-storage.ts:330/537) wrapped in a `KeyedEnvelope` that deliberately stores the plaintext `__mochiKey` so `keys()` can enumerate (documented at line 69, read at 406), and with `offloadBinary: true` (imageCache.ts:166) the raw bytes go to `<sha256(key)>/<sha256(bytes)>.bin`; so computing `sha256('MochiImage:Original:' + candidateSrc)` both confirms a guessed source and yields the blob pointer to the full original bytes, bypassing `safeOriginalContentType`. I am downgrading to BUG rather than MEDIUM for two reasons. First, there is no exploit without the operator doing the one thing the option's own docstring forbids — the mitigation here is documentation, which is why I am not calling it a false positive, but it is also why it is not a live vulnerability in any supported configuration. Second, the exposure window is narrower than stated: `resolvePublicFiles`/`registerPublicRoutes` scan and register once at boot (Mochi.ts:1831), so in production only cache files already on disk at startup become routes — the attack needs a persisted cacheDir surviving a restart, not the default ephemeral `./.mochi/image-cache`; the live dev watcher is the only path that picks up newly written entries. The recommendation (resolve both to absolute paths and throw from `Mochi.serve()` and the build CLI, mirroring `staticDirs.ts`) is correct and cheap, so this is worth fixing as a boot-validation gap.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-10-05)
