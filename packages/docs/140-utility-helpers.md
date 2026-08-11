---
title: 'Utility helpers'
slug: utility-helpers
description: 'Helper functions for building JSON responses, error responses, and form-action results.'
---

<script>
  import SeeItInAction from './_components/SeeItInAction.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Utility helpers

Functions exported from `mochi-framework` for shaping responses and form-action results. Each helper is documented in depth where it is used. This page is an index.

### Response helpers

`json(data, init?)` builds a JSON `Response` with the right `Content-Type`. Use it from `Mochi.api()` handlers and middleware.

```ts
import { json } from 'mochi-framework';

return json({ ok: true }, { status: 201 });
```

`error(status, message?)` throws a `MochiHttpError` that the framework catches and renders as the configured error page (or a JSON envelope from API routes). Omit `message` to get the canonical status text — `Not Found`, `Too Many Requests`, … — with unknown codes falling back to `Error <status>`. See [Error handling](/docs/error-handling/).

<VersionNote since="0.10.0" message="Calling error(status) without a message requires mochi-framework 0.10.0." />

```ts
import { error } from 'mochi-framework';

if (!user) error(404, 'User not found');
if (!session) error(401); // → "Unauthorized"
```

`apiError(status, message)` returns a JSON error `Response` shaped as `{ error: { message, status } }`. Use it inside `Mochi.api()` for a typed error without unwinding the stack. See [API routes](/docs/api-routes/).

```ts
import { apiError } from 'mochi-framework';

return apiError(400, 'Missing id');
```

### Form-action helpers

Use these as return values from a `Mochi.page` action. See [Defining routes](/docs/defining-routes/) and [Progressive enhancement](/docs/progressively-enhancing-forms-with-enhance/) for the full action lifecycle.

`fail(status, data)` re-renders the page with `form = { ok: false, action, status, data }` and the given HTTP status. The payload nests under `form.data`, not on `form` itself. Use it for validation errors.

```ts
import { fail } from 'mochi-framework';

if (!username) return fail(400, { error: 'Username required', username });
```

```svelte
{#if form?.data?.error}<p>{form.data.error}</p>{/if}
```

`success(data?)` re-renders the page with `form = { ok: true, action, data }` and HTTP 200. Use it when the action completes and you want to stay on the page.

```ts
import { success } from 'mochi-framework';

return success({ message: 'Saved.' });
```

`redirect(status, location)` issues an HTTP redirect when returned from a form action or a [`serverProps` resolver](/docs/defining-routes/#redirecting-from-serverprops). `status` must be `301`, `302`, `303`, `307`, or `308`. Use 303 for the standard POST/Redirect/GET pattern.

```ts
import { redirect } from 'mochi-framework';

return redirect(303, '/dashboard');
```

### Sealed tokens

`encryptPayload(plaintext, { aad?, compress? })` and `decryptPayload(token, { aad? })` seal a string into an opaque, tamper-proof base64url token (AES-256-SIV keyed from `MOCHI_KEY`) and open it again. `decryptPayload` returns `null` on any tamper or `aad` mismatch. This is the same primitive Mochi uses for server-island props. Use it for short-lived signed values such as form challenges or magic links.

```ts
import { encryptPayload, decryptPayload } from 'mochi-framework';

const token = encryptPayload(JSON.stringify({ iat: Date.now() }), { aad: 'my-form' });
const opened = decryptPayload(token, { aad: 'my-form' }); // string | null
```

<SeeItInAction
demos={[{ href: "/demos/url/", title: "Isomorphic URL", hook: "How the isomorphic URL helper works — one import that reads the request URL on the server and window.location on the client." }]}
/>
