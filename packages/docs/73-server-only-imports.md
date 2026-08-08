---
title: 'Server-only imports'
slug: server-only-imports
description: 'Keep server-only modules like bun:sqlite out of client bundles with the .server.ts convention.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Server-only imports

Any module reachable from a hydratable island gets bundled into the client. To use a server-only library (`bun:sqlite`, `node:fs`, anything that touches the filesystem) from inside an island, put the library plus a thin wrapper in a `*.server.ts` file. On the client, Mochi replaces these files with stubs that throw if used. The real module compiles for SSR only.

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

The `.server.ts` (or `.server.js`) suffix is the whole convention — no runtime API, no config. Import with the extension (`./db.server.ts`). Extensionless `./db.server` also works.

### Types are free

A type-only import is erased before the client build resolves anything, so a `.server.ts` file is also the right home for the types describing its data — even for types used inside a hydratable island.

```ts
// db.server.ts
export interface Row {
  id: number;
  title: string;
}

export const listRows = (): Row[] => db.query('SELECT * FROM rows').all() as Row[];
```

```svelte
<!-- RowList.svelte — hydratable island -->
<script lang="ts">
  import type { Row } from './db.server.ts';

  let { rows }: { rows: Row[] } = $props();
</script>
```

Mochi stubs only value imports. Use `import type` (or `import { type Row }`) so the compiler drops the import instead of resolving it to a stub.

<Callout type="warning">

**Wrap usage in `hydratable()` or `isServer`.** The stub throws on access. If you call a `.server.ts` export from client-running code (an `onclick` handler, an `$effect`), the page throws at runtime. The `hydratable()` producer function never runs on the client, so wrapping the call there is safe. Read the value once on the server, ship it through `hydratable()` or a prop, and use the resolved value on the client.

</Callout>

### What gets stubbed

On the client, every export of a `.server.ts` file throws on any use. The error names the export and its origin file:

```
getVersion from /…/db.server.ts was called on the client; this is a server-only export.
```

### Server-only components

<VersionNote since="0.10.0" message="Server-only components (*.server.svelte) ship in the next Mochi release (0.10.0). This section describes the upcoming API." />

Name a component `*.server.svelte` to keep it SSR-only. It renders on the server like any component, but the client build replaces it with a stub, so it never ships to the browser — even when an island pulls it in through a barrel re-export.

```svelte
<!-- Changelog.server.svelte — rendered on the server, stripped from client bundles -->
<script lang="ts">
  import { readFileSync } from 'node:fs';

  const entries = readFileSync('CHANGELOG.md', 'utf8');
</script>

<pre>{entries}</pre>
```

Import it with the extension (`./Changelog.server.svelte`). The framework's own `ViewTransitions` and `RawScript` use this convention.

<Callout type="warning">

**Don't hydrate a `.server.svelte`.** A `mochi:hydrate*` or `mochi:clientOnly` directive on one is a compile error, and rendering one anywhere deeper inside a hydrated island's subtree logs a build warning — the client stub would throw at hydration. `mochi:defer` (without also-hydrate) stays fine: a deferred island renders on the server only.

</Callout>

Only the default (component) export is stubbed. For server-only _values_, use a `.server.ts` file.

### Unsupported

- `export * from './x'` — Mochi warns at build time. Declare named exports in the `.server.ts` file directly.

<SeeItInAction
demos={[{ href: "/demos/data-loading/", title: "Data Loading", hook: "How server-side data loading works — fetch on the server, cache with MochiCache, and render at request time." }]}
/>
