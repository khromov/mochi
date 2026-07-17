---
title: 'Progressively enhancing forms with enhance'
slug: progressively-enhancing-forms-with-enhance
description: 'Progressively enhance HTML forms to submit via fetch when JavaScript is available.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Progressively enhancing forms with enhance

`enhance` is a Svelte attachment that progressively enhances `<form method="POST">`. The same server action runs whether JS is available or not; with `{@attach enhance(...)}` the client submits over `fetch`, the server returns a JSON `MochiEnhanceResult` envelope, and there is no full-page reload.

```svelte
<!-- file: src/Login.svelte -->
<script>
  import { enhance } from 'mochi-framework';
</script>

<form method="POST" action="?/login" {@attach enhance()}>
  <input name="username" />
  <input name="password" type="password" />
  <button type="submit">Log in</button>
</form>
```

Place the form inside a hydrated island (`mochi:hydrate`, `mochi:hydrate:visible`, or `mochi:defer mochi:hydrate`). When hydration is skipped the attachment never runs and the form falls back to a native HTML POST — that is the progressive-enhancement contract.

`enhance` is a factory: call it as `{@attach enhance()}` even with no options. Attachments require Svelte 5.29+.

### Wire format

`enhance` adds `Accept: application/json` and `x-mochi-action: true` to the POST. The server detects either header and responds with one of four shapes:

```ts
type MochiEnhanceResult =
  | { type: 'success'; status: number; data?: unknown }
  | { type: 'failure'; status: number; data?: unknown }
  | { type: 'redirect'; status: number; location: string }
  | { type: 'error'; status?: number; error: unknown };
```

HTTP status is `200` for `success`, `failure`, and `redirect`; the body's `status` field carries the action's status. For `error`, the HTTP status matches the error code. `data` is encoded with [devalue](https://www.npmjs.com/package/devalue) so `Date`, `Map`, `Set`, `BigInt`, and cyclic references survive the wire.

### Default fallback

Without a callback, `enhance` runs a minimal default per result type:

| `result.type` | Default                                           |
| ------------- | ------------------------------------------------- |
| `success`     | `form.reset()`                                    |
| `failure`     | nothing (provide a callback to update the UI)     |
| `redirect`    | `window.location.assign(result.location)`         |
| `error`       | `console.error('[mochi] enhance:', result.error)` |

<Callout type="warning">

**The default fallback is intentionally lean.** Mochi has no client-side `page.form` store, no `goto`, and no `invalidateAll` — the framework cannot auto-update component props or re-run server data after a submission. Pass a `submit` callback to react to `failure` or to do anything beyond a redirect.

</Callout>

When the same component renders both as a hydrated island (where `enhance` will fire) and as a plain SSR-only child (where it won't), call [`isHydratable()`](/docs/selective-hydration/#ishydratable) to skip the SSR `form`-prop peek when the client will take over.

### Submit callback

Pass a function as the argument. It runs once per submit and may return a result handler that fully replaces the default fallback:

```svelte
<!-- file: src/Login.svelte -->
<script>
  import { enhance } from 'mochi-framework';
  import type { MochiSubmitFunction } from 'mochi-framework';

  let errorMessage = $state<string | null>(null);
  let pending = $state(false);

  const handleLogin: MochiSubmitFunction<{ username: string }, { error: string }> = ({ formData }) => {
    pending = true;
    errorMessage = null;

    return ({ result, formElement }) => {
      pending = false;
      if (result.type === 'success') {
        formElement.reset();
      } else if (result.type === 'failure') {
        errorMessage = result.data?.error ?? 'Sign-in failed';
      }
    };
  };
</script>

<form method="POST" {@attach enhance(handleLogin)}>
  <!-- inputs -->
  <button type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Log in'}</button>
</form>
```

The result handler receives `{ result, formElement, formData, action, update }`. Call `update({ reset?: boolean })` to re-invoke the default fallback — useful when layering extra behavior on top of it.

### onPending

Pass an options object with `onPending` instead of tracking a `pending` flag inside the submit function. It fires `true` immediately before the fetch and `false` once the result handler settles (or when the submission is cancelled):

```svelte
<!-- file: src/Login.svelte -->
<script>
  import { enhance } from 'mochi-framework';
  import type { MochiEnhanceOptions, MochiSubmitFunction } from 'mochi-framework';

  let errorMessage = $state<string | null>(null);
  let pending = $state(false);

  const handleLogin: MochiSubmitFunction<{ username: string }, { error: string }> = () => {
    errorMessage = null;
    return ({ result }) => {
      if (result.type === 'failure') {
        errorMessage = result.data?.error ?? 'Sign-in failed';
      }
    };
  };

  const opts: MochiEnhanceOptions<{ username: string }, { error: string }> = {
    submit: handleLogin,
    onPending: (v) => {
      pending = v;
    },
  };
</script>

<form method="POST" {@attach enhance(opts)}>
  <!-- inputs -->
  <button type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Log in'}</button>
</form>
```

`onPending` fires `false` from a `finally` block, so it resets even if the fetch throws or the abort signal fires.

### Cancelling

The `submit` callback receives `cancel` and `controller`:

- `cancel()` — bail out before `fetch` is issued. No callback runs.
- `controller.abort()` — cancel an in-flight request. The `AbortError` is silently swallowed.

### Server-side

No server changes are needed beyond declaring the action. The same `Mochi.page(path, { actions })` definition serves both the no-JS HTML POST flow and the enhanced JSON flow:

```ts
// file: src/index.ts
import { Mochi, fail, success } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/login': Mochi.page('./src/Login.svelte', {
      actions: {
        default: ({ formData }) => {
          const username = String(formData.get('username') ?? '');
          if (!username) return fail(400, { error: 'Username required' });
          return success({ username });
        },
      },
    }),
  },
});
```

Returning a `Response` directly from an action bypasses the JSON envelope on enhanced submissions — treat that path as an escape hatch.

<Callout type="warning">

**Wrap data in `success()` to round-trip it to the client.** A plain return like `return { username }` strips the data on the enhanced path and the result handler receives an empty `data` object. This matches the non-enhanced behavior. Always use `success()` when the client needs the returned data.

</Callout>

### deserialize

`deserialize(text)` decodes a raw `MochiEnhanceResult` envelope. Use it when rolling your own `onsubmit` instead of `{@attach enhance(...)}`:

```svelte
<!-- file: src/Login.svelte -->
<script>
  import { deserialize } from 'mochi-framework';

  async function onsubmit(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const response = await fetch(form.action, {
      method: 'POST',
      headers: { Accept: 'application/json', 'x-mochi-action': 'true' },
      body: new URLSearchParams(new FormData(form) as unknown as Record<string, string>),
    });
    const result = deserialize(await response.text());
    // …
  }
</script>
```

### When to use enhance

Reach for `enhance` when the action's outcome should update UI without a navigation flicker — interactive forms, optimistic patterns, inline validation. Stick with a plain `<form method="POST">` when the action ends in a redirect anyway and the JS bundle is not worth shipping.

<SeeItInAction
demos={[
{ href: "/demos/login/", title: "Form Actions", hook: "A login form rendered twice — plain HTML POST and intercepted with {@attach enhance(...)}." },
{ href: "/demos/form-errors/", title: "Form Errors", hook: "A thrown action error shown inline via {@attach enhance(...)}, or as the Mochi error page on plain submit." },
{ href: "/demos/form-return-data/", title: "Using form return data", hook: "An action returns data via success({...}); {@attach enhance(...)} updates the UI in place, plain HTML re-renders the page." },
]}
/>
