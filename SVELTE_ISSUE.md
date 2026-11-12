<!--
Draft upstream issue for sveltejs/svelte — NOT filed. Remove this file before merging.

Existing upstream coverage (searched 2026-11-13): no open or closed issue reports this exact behaviour.
Related:
- sveltejs/svelte#17313 (closed) — a rejected hydratable promise crashed the Node process; fixed by the
  `.catch(() => {})` guards. Same code path, different symptom.
- sveltejs/svelte#18936 / PR #18927 (open) — `hydratable` ignores the server value after a component's first
  top-level `await` (client side). Different bug, same "repeated hydratable" area.
- sveltejs/svelte PR #18963 (open) — "add `Warp` and `withWarp`, deprecate `hydratable`". It reimplements
  server `hydratable` as `warp.getOrInsertComputed(key, fn)`, which no longer re-runs `fn` for an existing key,
  so it would incidentally fix this if merged as-is. Worth linking so the behaviour is kept intentionally (or a
  regression test is added).
-->

# `hydratable`: in dev, a repeated key re-runs the fallback during SSR and crashes the render if it throws or rejects

### Describe the bug

On the server, when `hydratable(key, fn)` is called with a key that is already set in the current render, production returns the stored value without calling `fn`. In development (`DEV` from `esm-env`, i.e. `NODE_ENV=development`), Svelte calls `fn()` again to check for clobbering:

```js
// packages/svelte/src/internal/server/hydratable.js (5.56.8 and 5.57.3, lines 24–32)
if (entry !== undefined) {
  if (DEV) {
    const comparison = compare(key, entry, encode(key, fn()));
    comparison.catch(() => {});
    hydratable.comparisons.push(comparison);
  }

  return /** @type {T} */ (entry.value);
}
```

`fn()` is called synchronously and outside any `try`. So a development-only consistency check changes behaviour:

1. **Sync throw:** if `fn` throws, the error escapes `hydratable()` and fails the render (or the nearest `<svelte:boundary>`). Production renders the same app fine.
2. **Async rejection:** if `fn` returns a promise that rejects, `encode()` turns it into `hydratable_serialization_failed`, which rejects the comparison. `#collect_hydratables` awaits the comparison, so the whole `render()` rejects. The error message is also misleading: it reports a serialization failure, but nothing failed to serialize. The fallback rejected.

A fallback that can't (or shouldn't) run on a repeated key is a normal pattern. For example, a child reuses a key its parent always sets first, and its fallback throws to assert that invariant. Or the fallback runs an expensive query or a non-idempotent call that should happen once per request. The docs don't mention that `fn` can run a second time on the server in dev, so the first time you see this is a dev-only crash.

We hit this in a framework where an island (child component) reuses the page's `hydratable` key. The page broke as soon as the dev server started setting `NODE_ENV=development`. Before that, `esm-env`'s `DEV` was falsy and the same code worked.

### Reproduction

Plain Svelte, Node, `render` from `svelte/server`, `experimental.async: true`.

`App.svelte`

```svelte
<script>
  import { hydratable } from 'svelte';
  import Child from './Child.svelte';

  const user = await hydratable('user', () => ({ name: 'Ada' }));
</script>

<p>parent: {user.name}</p>
<Child />
```

`Child.svelte`

```svelte
<script>
  import { hydratable } from 'svelte';

  // The parent always sets 'user' first, so this fallback is never needed.
  const user = await hydratable('user', () => {
    throw new Error('fallback should not run: parent already set "user"');
  });
</script>

<p>child: {user.name}</p>
```

The async variant: `AsyncApp.svelte` is the same as `App.svelte` with `() => Promise.resolve({ name: 'Ada' })`, and `AsyncChild.svelte` uses `() => Promise.reject(new Error('fallback should not run'))`.

`repro.mjs` (in a folder containing `package.json` `{"type":"module"}` and `npm i svelte`; the `.svelte` files are in the parent folder)

```js
import { compile } from 'svelte/compiler';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const { version } = createRequire(import.meta.url)('svelte/package.json');
mkdirSync('./out', { recursive: true });
for (const name of ['App', 'Child', 'AsyncApp', 'AsyncChild']) {
  const { js } = compile(readFileSync(`../${name}.svelte`, 'utf8'), {
    filename: `${name}.svelte`,
    generate: 'server',
    experimental: { async: true },
  });
  writeFileSync(`./out/${name}.js`, js.code.replaceAll(/'\.\/(\w+)\.svelte'/g, "'./$1.js'"));
}
const { render } = await import('svelte/server');
console.log(`svelte@${version}, NODE_ENV=${process.env.NODE_ENV ?? '(unset)'}`);
for (const name of ['App', 'AsyncApp']) {
  const { default: C } = await import(`./out/${name}.js`);
  try {
    const { body } = await render(C);
    console.log(`  ${name}: OK  ${body.replace(/<!--[^>]*-->/g, '')}`);
  } catch (e) {
    console.log(`  ${name}: THROWS  ${e.message.split('\n').slice(0, 2).join(' | ')}`);
  }
}
```

Run it with `NODE_ENV=production node repro.mjs` and with `NODE_ENV=development node repro.mjs`.

**Expected:** the same output in both modes: `parent: Ada` / `child: Ada`. At most, dev logs a warning that the fallback for an existing key could not be compared.

**Actual:** production succeeds; development fails both renders.

### Logs

```
svelte@5.56.8, NODE_ENV=production
  App: OK  <p>parent: Ada</p> <p>child: Ada</p>
  AsyncApp: OK  <p>parent: Ada</p> <p>child: Ada</p>
svelte@5.56.8, NODE_ENV=development
  App: THROWS  fallback should not run: parent already set "user"
  AsyncApp: THROWS  hydratable_serialization_failed | Failed to serialize `hydratable` data for key `user`.
svelte@5.57.3, NODE_ENV=production
  App: OK  <p>parent: Ada</p> <p>child: Ada</p>
  AsyncApp: OK  <p>parent: Ada</p> <p>child: Ada</p>
svelte@5.57.3, NODE_ENV=development
  App: THROWS  fallback should not run: parent already set "user"
  AsyncApp: THROWS  hydratable_serialization_failed | Failed to serialize `hydratable` data for key `user`.
```

Stack traces (svelte 5.57.3, `NODE_ENV=development`):

```
--- App
Error: fallback should not run: parent already set "user"
    at file://out/Child.js:12:11
    at hydratable (file://node_modules/svelte/src/internal/server/hydratable.js:26:55)
    at Array.<anonymous> (file://out/Child.js:11:29)
    at Renderer.run (file://node_modules/svelte/src/internal/server/renderer.js:243:42)
    at file://out/Child.js:10:31
    at file://node_modules/svelte/src/internal/server/renderer.js:413:11
    at Renderer.child (file://node_modules/svelte/src/internal/server/renderer.js:302:18)
    at Renderer.component (file://node_modules/svelte/src/internal/server/renderer.js:411:8)
    at Child (file://out/Child.js:6:13)
    at file://out/App.js:17:3
--- AsyncApp
Svelte error: hydratable_serialization_failed
Failed to serialize `hydratable` data for key `user`.

`hydratable` can serialize anything [`uneval` from `devalue`](https://npmjs.com/package/devalue) can, plus Promises.

Cause:
    at Array.<anonymous> (file://out/AsyncChild.js)
    at file://out/AsyncChild.js:9:31
    at AsyncChild (file://out/AsyncChild.js)
    at file://out/AsyncApp.js:17:3
    at AsyncApp (file://out/AsyncApp.js)
    at AsyncLocalStorage.run (node:internal/async_local_storage/async_context_frame)
```

### Suggested fix

A dev-only check should not change what renders. In the `entry !== undefined && DEV` branch:

- Wrap the `fn()` call in `try`/`catch`. If it throws, skip the comparison (optionally emit a dev warning such as `hydratable_fallback_failed` naming the key and the stack of the first `set`), and return `entry.value` exactly as production does.
- For a returned promise that rejects, catch the rejection in the comparison path and treat it the same way (skip or warn). Don't surface it as `hydratable_serialization_failed`, which is both fatal and misleading here.
- Optionally, document that in dev the fallback of a repeated key is called again to detect clobbering, so it should be side-effect-free and must be able to produce the same value.

Note that the open PR #18963 (`Warp`) reimplements `hydratable` as `getOrInsertComputed`, which doesn't re-run `fn` for an existing key. If that is the intended direction, a regression test for "repeated key with a throwing/rejecting fallback renders in dev" would lock it in.

### System Info

```
System:
  OS: Linux 7.0 Debian GNU/Linux 12 (bookworm)
  Container: Yes
Binaries:
  Node: 24.22.3
  npm: 11.19.1
  bun: 1.4.4
npmPackages:
  svelte: 5.56.8 and 5.57.3 (latest at time of writing) — same result
```

### Severity

annoyance. Workaround: make every repeated-key fallback return a value identical to the first one on the server, e.g. by passing the parent's value through context, even when that fallback is never meant to run.
