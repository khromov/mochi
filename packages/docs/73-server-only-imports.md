---
title: 'Server-only imports'
slug: server-only-imports
description: 'Keep server-only modules like bun:sqlite out of client bundles using the .server.ts convention.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Server-only imports

Any module reachable from a hydratable island gets bundled into the client. To use a server-only library (`bun:sqlite`, `node:fs`, anything that touches the filesystem) from inside an island, put the library plus a thin wrapper in a `*.server.ts` file. Mochi replaces these files with throwing-Proxy stubs on the client; the real module is only compiled for SSR.

```ts
// db.server.ts
import { Database } from 'bun:sqlite';

const db = new Database(':memory:');

export const getVersion = (): string => (db.query('SELECT sqlite_version() as v').get() as { v: string }).v;
```

```svelte
<!-- FactCard.svelte — hydratable island -->
<script lang="ts">
  import { hydratable } from 'svelte';
  import { getVersion } from './db.server.ts';

  const version = await hydratable('app:sqlite-version', () => getVersion());
</script>

<p>SQLite {version}</p>
```

The `.server.ts` (or `.server.js`) suffix is the entire convention — no runtime API to call, no config. Import with the extension (`./db.server.ts`); extensionless `./db.server` also works. Types follow the import normally.

<Callout type="warning">

**Wrap usage in `hydratable()` or `isServer`.** The stub throws on access. If you call a `.server.ts` export from client-running code (an `onclick` handler, an `$effect`), the page will throw at runtime. `hydratable()`'s producer function never runs on the client — it reads the value cached at SSR time — so wrapping the call there is safe. Read the value once on the server, ship it through `hydratable()` or a prop, and use the resolved value on the client.

</Callout>

### What gets stubbed

Every named and default export of a `.server.ts` file is replaced with a `Proxy` that throws on both function calls and property access. The error message names the export and its origin file so a stray client-side use surfaces cleanly:

```
getVersion from /…/db.server.ts was called on the client; this is a server-only export.
```

### Not supported

- `export * from './x'` — Mochi warns at build time; declare named exports in the `.server.ts` file directly.
- `.server.svelte` — component-level convention is not provided. Put server-only code in plain TS and call it from a component.

<SeeItInAction
  demos={[{ href: "/demos/data-loading/", title: "Data Loading", hook: "Server-side fetch from PokéAPI cached via MochiCache and rendered at request time." }]}
/>
