# mochi-shared

Small internal helpers shared by the **deployed sites** — `packages/site` and `packages/support`. Private; never published to npm.

## Scope — read this before adding anything

This package exists only to stop the site packages copy-pasting the same snippet twice. It is **not** part of the framework's public surface.

- ✅ **May be used by**: `packages/site`, `packages/support`, and any future deployed app in this monorepo that is not a template source.
- ❌ **Must never be used by `packages/mochi`.** The framework is published to npm and cannot depend on a private workspace package — importing this from `packages/mochi` would break the published `mochi-framework` for every consumer. The dependency only ever points one way: sites → `mochi-framework`, sites → `mochi-shared`. Anything genuinely framework-worthy belongs in `packages/mochi` and its docs, not here.
- ❌ **Must never be used by `packages/demos` or `packages/minimal`.** Both double as template sources, so they may only depend on published packages — a `workspace:*` dep would not resolve once the template is copied out of the monorepo. `packages/demos/src/analytics.ts` carries its own copy of the `analytics` handle; keep the two in sync by hand.

Keep this package tiny. If a helper is useful to Mochi users rather than just to these three sites, it belongs in the framework instead.

## Contents

| Export        | What                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `analytics()` | Builds a `Handle` that fills the `{{mochi.analytics}}` shell placeholder with the Umami snippet when `MOCHI_DOCKER=true` |

Using `analytics()` requires a `{{mochi.analytics}}` placeholder in the site's `shell.html` — without it the snippet has nowhere to land, and without the handle the placeholder renders as literal text.

Pass `exclude` to keep pages out of the stats — the placeholder is still cleared, so nothing leaks into the markup:

```ts
handle: sequence(analytics({ exclude: ['/ci/dashboard'] }));
```
