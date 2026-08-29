---
title: 'Sync'
slug: sync
ogTitle: 'Realtime data sync with Mochi.serve({ sync })'
description: 'Realtime, server-authoritative data sync for Svelte islands — a typed schema, sync() runes in the browser, pluggable auth, over WebSocket, backed by reflectdb.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Sync

<VersionNote since="0.10.0" message="Mochi sync is new in 0.10.0." />

Keep a dataset live across every browser tab. Declare a typed schema once, implement `query`/`mutate` on the server, and read and write rows from a hydrated island with a runes-backed `sync()`. The server is authoritative, client writes are optimistic, and updates fan out to every subscriber over one WebSocket. Backed by [reflectdb](https://github.com/TimMikeladze/reflectdb).

<Callout type="warning">

Sync is **WebSocket-only** in v1 and ships JavaScript to the browser, so it works in hydrated islands (`mochi:hydrate*`), not in server-only rendering. An island shows empty rows during SSR and fills in after it connects.

</Callout>

### Shared schema

The schema is isomorphic — the same file is imported by your server routes and your islands. Import it from `mochi-framework/sync`, which carries only the schema helpers (no runtime).

```ts
// schema.ts
import { defineSyncQueries, t } from 'mochi-framework/sync';

export type Todo = { id: string; text: string; done: boolean };

export const queries = defineSyncQueries({
  todos: { row: t<Todo>() },
});
```

`t<T>()` is a phantom type helper — it declares the row shape with no runtime value.

### Server config

Pass `sync: defineSync({ … })` to `Mochi.serve()`. Each table gets a `query` (read) and, to allow writes, a `mutate`. Both receive the `db` handle you thread in, so the same store answers reads and takes writes.

```ts
import { defineSync } from 'mochi-framework/sync';
import { queries, type Todo } from './schema';

const todos = new Map<string, Todo>();

Mochi.serve({
  sync: defineSync({
    queries,
    db: todos, // threaded untouched to every query/mutate
    tables: {
      todos: {
        query: (ctx, db) => [...db.values()],
        mutate: async (op, ctx, db) => {
          if (op.type === 'delete') return void db.delete(op.rowId);
          db.set(op.rowId, { id: op.rowId, ...op.payload } as Todo);
        },
      },
    },
  }),
});
```

`op` is `{ type: 'insert' | 'update' | 'delete', rowId, payload }`. `ctx` is `{ auth, params }`.

<Callout type="danger">

`t<Todo>()` types the payload at compile time only — it does **no runtime validation**. A client can send any JSON. Validate `op.payload` inside `mutate` before you persist it.

</Callout>

<Callout type="info">

reflectdb runs your `query` only when a `db` is present. Mochi defaults `db` to `{}` when you omit it, so a query that closes over its own store still runs — but pass your real handle whenever you have one.

</Callout>

Other `tables` options mirror reflectdb: `authorize`, `serverSet`, `room`, `broadcast`, `count`, `groupBy`. Top-level options: `views` (read-only `view()` queries), `rooms` (access-control callbacks by pattern), and `rateLimit` (global and per-table write limits).

### Storage

Where the op log lives. Give sync its **own** file — never share the queue's.

| `storage`                       | Backing                                        |
| ------------------------------- | ---------------------------------------------- |
| `'memory'` (default)            | reflectdb's in-process op log; lost on restart |
| `{ sqlite: '.db/sync.sqlite' }` | SQLite file (`bun:sqlite`)                     |
| `{ postgres: url }`             | Postgres, for multi-instance / HA              |

<Callout type="info">

Under a Postgres connection pool, reflectdb's cross-instance advisory locks are best-effort (they are session-level, and a pool hands out different sessions). This matches `pg.Pool` and is reflectdb's documented behavior.

</Callout>

### Auth

Sync auth is pluggable through a signed-ticket bridge. reflectdb only ever sees a bearer token, so Mochi exposes a token endpoint where the full request context is available: your `auth(req)` runs there, reads cookies via `getRequestContext()`, and Mochi mints a short-lived HMAC ticket (signed with the framework `secretKey`) that reflectdb re-verifies per operation batch. When a ticket expires, reflectdb asks the client to refetch — transparently.

```ts
defineSync({
  queries,
  auth: (req) => {
    const userId = getRequestContext().cookies.get('user');
    return userId ? { userId } : null; // null rejects the connection
  },
  tables: {/* … */},
  ticketTtlMs: 600_000, // default: 10 minutes
});
```

Omit `auth` to serve anonymous clients. The token endpoint (`<assetPrefix>/sync/token`) is POST-only and JSON-only, so it is CSRF-safe by construction.

### `sync()` in islands

Inside a hydrated island, `sync<Row>(table)` returns a reactive handle. `rows`, `status`, `pending`, and `total` are `$state`-backed; the mutators update optimistically and sync to the server.

```svelte
<script lang="ts">
  import { sync } from 'mochi-framework';
  import type { Todo } from './schema';

  const todos = sync<Todo>('todos');

  let text = $state('');
</script>

<p>{todos.status}{todos.pending ? ` · ${todos.pending} pending` : ''}</p>

<ul>
  {#each todos.rows as todo (todo.id)}
    <li>
      <input type="checkbox" checked={todo.done} onchange={() => todos.update(todo.id, { done: !todo.done })} />
      {todo.text}
      <button onclick={() => todos.remove(todo.id)}>×</button>
    </li>
  {/each}
</ul>

<button
  onclick={() => {
    todos.insert({ text, done: false });
    text = '';
  }}>Add</button
>
```

`insert(payload, id?)` returns the row id. The handle also exposes `loadMore(count)` for windowed queries and `destroy()` (called automatically on component teardown).

<Callout type="warning">

reflectdb keys subscriptions by table name, so a table has **one params set per connection** — the last `sync(table, params)` wins for that table. Split by table for independent parameterized views.

</Callout>

### Connections

Every island shares one connection by default (`'default'`) — one client, one socket, one local store per tab. Pass `{ connection }` to put an island on its own named connection, so two islands can hold **independent** state (each has its own client, socket, and local store):

```ts
const todos = sync<Todo>('todos', undefined, { connection: 'island-a' });
```

Connections are shared per name per tab, so two islands naming the same connection stay together.

### Offline & resync

`syncConnection(name?)` returns a control handle for a named connection (default `'default'`), with reactive `online`, `status`, and `pending`:

```svelte
<script lang="ts">
  import { sync, syncConnection } from 'mochi-framework';

  const todos = sync<Todo>('todos', undefined, { connection: 'island-a' });
  const conn = syncConnection('island-a');
</script>

<button onclick={() => conn.setOnline(!conn.online)}>
  {conn.online ? 'Go offline' : 'Go online'}
</button>
<p>{conn.status}{conn.pending ? ` · ${conn.pending} queued` : ''}</p>
```

`setOnline(false)` drops the socket while keeping local rows; writes made offline queue locally (watch `pending` climb) and stop reaching the server or other connections. `setOnline(true)` reconnects, resyncs a fresh snapshot, and pushes the queued writes — every side converges.

### Server-side writes

`Mochi.sync()` returns the live reflectdb server for out-of-band writes. When your data lives in your own store, write it and then broadcast the diff:

```ts
todos.set(id, { id, text: 'from the server', done: false });
await Mochi.sync().notifyChange('todos'); // re-runs query, fans the diff out
```

`emit(table, payload)` / `applyServerOp(...)` write reflectdb's own mirror instead — use them when the mirror is your source of truth, not when a `query` reads an external store. `Mochi.sync()` throws a clear error if `sync` was never configured.

<SeeItInAction
demos={[{ href: "/demos/sync/", title: "Realtime sync", hook: "How Mochi sync works — two islands share one live todo list, server-authoritative, over WebSocket." }]}
/>
