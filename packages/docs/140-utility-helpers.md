---
title: 'Utility helpers'
slug: utility-helpers
description: 'Small helper functions for building JSON responses, error responses, and form-action results.'
---

<script>
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Utility helpers

Small functions exported from `mochi-framework` for shaping responses and form-action results. Each helper is documented in depth where it is used; this page is a single index.

### Response helpers

`json(data, init?)`: build a JSON `Response` with the right `Content-Type`. Use from `Mochi.api()` handlers and middleware.

```ts
import { json } from 'mochi-framework';

return json({ ok: true }, { status: 201 });
```

`error(status, message)`: throw a `MochiHttpError` that the framework catches and renders as the configured error page (or a JSON envelope from API routes). See [Error handling](error-handling).

```ts
import { error } from 'mochi-framework';

if (!user) error(404, 'User not found');
```

`apiError(status, message)`: return — don't throw — a JSON error `Response` shaped as `{ error: { message, status } }`. Use inside `Mochi.api()` when you want a typed error without unwinding the stack. See [API routes](api-routes).

```ts
import { apiError } from 'mochi-framework';

return apiError(400, 'Missing id');
```

### Form-action helpers

Used as return values from a `Mochi.page` action. See [Defining routes](defining-routes) and [Progressive enhancement](use-enhance) for the full action lifecycle.

`fail(status, data)`: re-render the page with `form = { ok: false, ...data }` and the given HTTP status. Use for validation errors.

```ts
import { fail } from 'mochi-framework';

if (!username) return fail(400, { error: 'Username required', username });
```

`success(data?)`: re-render the page with `form = { ok: true, ...data }` and HTTP 200. Use when the action completes but you want to stay on the page.

```ts
import { success } from 'mochi-framework';

return success({ message: 'Saved.' });
```

`redirect(status, location)`: issue an HTTP redirect after the action runs. `status` must be `301`, `302`, `303`, `307`, or `308`. Use 303 for the standard POST/Redirect/GET pattern.

```ts
import { redirect } from 'mochi-framework';

return redirect(303, '/dashboard');
```

<SeeItInAction
demos={[{ href: "/demos/url/", title: "Isomorphic URL", hook: "One import for the current URL — reads from the request on the server, window.location on the client." }]}
/>
