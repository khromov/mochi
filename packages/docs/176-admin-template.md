---
title: 'Admin template'
slug: admin-template
description: 'Scaffold a login + dashboard + CRUD admin panel with the create-mochi admin template.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Admin template

A `create-mochi` starter that shows an auth + forms + CRUD stack composed together: a login page, a dashboard (with charts), a Products CRUD resource, and a profile page. Svelte + Tailwind v4, using every rendering mode — static SSR, [hydrated islands](/docs/selective-hydration/), and a [server island](/docs/server-islands/) — so each appears where it fits.

```sh
bun create mochi@latest my-admin --template admin
cd my-admin
bun install
bun run dev
```

The scaffold boots on `http://localhost:3333`. Sign in with the demo credentials `admin` / `mochi`.

<Callout type="warning">

The five stateful concerns — **sessions, password hashing, validation, rate limiting, migrations** — ship as **stub modules** under `src/lib/` with `// TODO` comments, not real implementations. The UI, routing, and form wiring are complete; the stubs are drop-in targets you replace with the real primitives (`Bun.password`, `bun:sqlite`, a session store, etc.). Static demo data stands in for a database.

</Callout>

### What's inside

| Path                          | Purpose                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/index.ts`                | `Mochi.serve()` — `setupTailwind` (dev), `sequence(rateLimit(), authGuard)`.                      |
| `src/routes/`                 | `auth.ts`, `dashboard.ts`, `products.ts` (list/new/edit), `profile.ts`.                           |
| `src/lib/auth.server.ts`      | Password hash/verify + session/profile — **stub**.                                                |
| `src/lib/validate.ts`         | Tiny field-rule validator feeding `fail()` — **stub**.                                            |
| `src/lib/rateLimit.ts`        | Pass-through `Handle` middleware — **stub**.                                                      |
| `src/lib/db.server.ts`        | Product reads/writes + `runMigrations()` — **stub** over seed data.                               |
| `src/lib/analytics.ts`        | Deterministic demo series for the dashboard charts.                                               |
| `src/migrations/001_init.sql` | Real schema (users, sessions, products) — not executed yet.                                       |
| `src/components/`             | `AdminLayout`, `ThemeToggle` + `LoginForm` (islands), `ProductForm`, chart + activity components. |

### Rendering modes on the dashboard

The dashboard deliberately uses all three of Mochi's rendering modes side by side:

- **Static SSR** — the **Revenue** sparkline is hand-rolled SVG computed on the server. It ships zero JavaScript. (Charting libraries draw their marks on the client after measuring the container, so they can't render geometry during SSR — for a static chart, server-rendered SVG is simpler and lighter.)
- **Hydrated island** — the **Live traffic** chart uses [FlareCharts](https://www.npmjs.com/package/@faintshadow/flarecharts) inside a `mochi:hydrate` island, measuring its container and appending a fresh point every 1.5s.
- **Server island** — **Recent activity** is a `mochi:defer` island: the page ships a skeleton, then fetches the list from `/_mochi/island/RecentActivity` after load.

### How forms surface errors

Actions validate with the `validate` stub and return `fail(400, { errors, values })` on invalid input. The form components read the result off the request context so fields repopulate and per-field errors render — the same [`enhance`](/docs/use-enhance/) path used everywhere else, so it works with or without JavaScript:

```ts
// src/routes/products.ts
create: async ({ formData }) => {
  const result = validate(productSchema, formData);
  if (!result.ok) {
    return fail(400, { errors: result.errors, values: result.values });
  }
  // TODO: createProduct(result.data) — persistence is stubbed.
  return success({ notice: 'Validated ✓ — persistence is stubbed.' });
};
```

### Filling in a battery

Each stub names the sibling primitive it stands in for. For example, real password verification is a one-liner once you drop the stub:

```ts
// src/lib/auth.server.ts
export async function verifyPassword(password: string, hash: string) {
  return await Bun.password.verify(password, hash); // was: throw 'not implemented'
}
```

The same pattern applies to the session store, validation, rate limiter, and migration runner — swap the stub body, keep the call sites.
