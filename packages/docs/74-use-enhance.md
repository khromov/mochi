---
title: 'Progressively enhancing forms with enhance'
slug: progressively-enhancing-forms-with-enhance
description: 'Progressively enhance HTML forms to submit over fetch when JavaScript is available.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Progressively enhancing forms with enhance

`enhance` is a Svelte attachment that progressively enhances `<form method="POST">`. The same server action runs whether JavaScript is available or not. With `{@attach enhance(...)}` the client submits over `fetch`, and the server returns a JSON `MochiEnhanceResult` envelope with no full-page reload.

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

Place the form inside a hydrated island (`mochi:hydrate`, `mochi:hydrate:visible`, or `mochi:defer mochi:hydrate`). When hydration is skipped, the attachment never runs and the form falls back to a native HTML POST. That is the progressive-enhancement contract.

`enhance` is a factory. Call it as `{@attach enhance()}` even with no options. Attachments require Svelte 5.29+.

### Wire format

`enhance` adds `Accept: application/json` and `x-mochi-action: true` to the POST. The server detects either header and responds with one of four shapes:

```ts
type MochiEnhanceResult =
  | { type: 'success'; status: number; data?: unknown }
  | { type: 'failure'; status: number; data?: unknown }
  | { type: 'redirect'; status: number; location: string }
  | { type: 'error'; status?: number; error: unknown };
```

HTTP status is `200` for `success`, `failure`, and `redirect`. The body's `status` field carries the action's status. For `error`, the HTTP status matches the error code. Mochi encodes `data` with [devalue](https://www.npmjs.com/package/devalue) so `Date`, `Map`, `Set`, `BigInt`, and cyclic references survive the wire.

In production, an unexpected `throw new Error(...)` is returned as the generic message `Internal Server Error`; its original message remains in server logs and lifecycle events. Errors created with `error(status, message)` and valid overrides returned by `handleError` remain explicit application responses.

### Default fallback

Without a callback, `enhance` runs a minimal default per result type:

| `result.type` | Default                                           |
| ------------- | ------------------------------------------------- |
| `success`     | `form.reset()`                                    |
| `failure`     | nothing (provide a callback to update the UI)     |
| `redirect`    | `window.location.assign(result.location)`         |
| `error`       | `console.error('[mochi] enhance:', result.error)` |

The `error` log is not part of the replaceable fallback: it fires on every submission, before any callback runs, so a custom handler that only branches on `success`/`failure` cannot turn a transport or server error into a silent no-op.

<Callout type="warning">

**The default fallback is intentionally lean.** Mochi has no client-side `page.form` store, `goto`, or `invalidateAll`, so it cannot auto-update component props or re-run server data after a submission. Pass a `submit` callback to react to `failure` or to do anything beyond a redirect.

</Callout>

When the same component renders both as a hydrated island and as a plain SSR-only child, call [`isHydratable()`](/docs/selective-hydration/#ishydratable) to skip the SSR `form`-prop peek when the client will take over.

### Submit callback

Pass a function. It runs once per submit and may return a result handler that replaces the default fallback for `success`, `failure`, and `redirect` (the `error` log above always fires):

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

<form method="POST" action="?/login" {@attach enhance(handleLogin)}>
  <!-- inputs -->
  <button type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Log in'}</button>
</form>
```

The result handler receives `{ result, formElement, formData, action, update }`. Call `update({ reset?: boolean })` to re-invoke the default fallback.

### onPending

Pass an options object with `onPending` instead of tracking a `pending` flag inside the submit function. It fires `true` right before the fetch and `false` once the result handler settles (or when the submission is cancelled):

```svelte
<!-- file: src/Login.svelte -->
<script>
  import { enhance } from 'mochi-framework';
  import type { MochiEnhanceOptions } from 'mochi-framework';

  let pending = $state(false);

  const opts: MochiEnhanceOptions = {
    onPending: (v) => {
      pending = v;
    },
  };
</script>

<form method="POST" action="?/login" {@attach enhance(opts)}>
  <!-- inputs -->
  <button type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Log in'}</button>
</form>
```

`onPending` fires `false` from a `finally` block, so it resets even if the fetch throws or the abort signal fires.

### Cancelling

The `submit` callback receives `cancel` and `controller`:

- `cancel()` — bail out before `fetch` runs. No callback runs.
- `controller.abort()` — cancel an in-flight request. The `AbortError` is swallowed.

### Server-side

Declare the action. The same `Mochi.page(path, { actions })` definition serves both the no-JS HTML POST flow and the enhanced JSON flow:

```ts
// file: src/index.ts
import { Mochi, fail, success } from 'mochi-framework';

await Mochi.serve({
  routes: {
    '/login': Mochi.page('./src/Login.svelte', {
      actions: {
        login: ({ formData }) => {
          const username = String(formData.get('username') ?? '');
          if (!username) return fail(400, { error: 'Username required' });
          return success({ username });
        },
      },
    }),
  },
});
```

Returning a `Response` directly from an action bypasses the JSON envelope on enhanced submissions. Treat that as an escape hatch.

<Callout type="warning">

**Wrap data in `success()` to round-trip it to the client.** A plain return like `return { username }` strips the data on the enhanced path, and the result handler receives an empty `data` object. Always use `success()` when the client needs the returned data.

</Callout>

### deserialize

`deserialize(text)` decodes a raw `MochiEnhanceResult` envelope. Use it when you roll your own `onsubmit` instead of `{@attach enhance(...)}`:

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

Use `enhance` when the action's outcome should update the UI without a navigation flicker — interactive forms, optimistic patterns, inline validation. Use a plain `<form method="POST">` when the action ends in a redirect anyway and the JavaScript bundle is not worth shipping.

<SeeItInAction
demos={[
{ href: "/demos/login/", title: "Form Actions", hook: "How form actions work — a form rendered twice, as a plain HTML POST and intercepted with {@attach enhance(...)}." },
{ href: "/demos/form-errors/", title: "Form Errors", hook: "How form action errors work — a thrown action error shows inline via {@attach enhance(...)}, or as the Mochi error page on a plain submit." },
{ href: "/demos/form-return-data/", title: "Using form return data", hook: "How form action return data works — an action returns success({...}); {@attach enhance(...)} updates the UI in place, plain HTML re-renders." },
]}
/>
