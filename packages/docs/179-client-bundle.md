---
title: 'Client bundle chunks'
slug: client-bundle
description: 'Assign modules in the island client bundle to named shared chunks.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Client bundle chunks

<VersionNote since="0.10.0" message="clientBundle ships in the next Mochi release (0.10.0). This page describes the upcoming API." />

Mochi builds every hydratable island in one pass and lets Bun split shared code into chunks. `clientBundle.chunks`
takes that decision back: map a module path to a chunk name and every module you give the same name ships as one file.

```ts
// file: src/index.ts
await Mochi.serve({
  clientBundle: {
    chunks: (id, { packageName }) => {
      if (packageName === 'chart.js' || packageName?.startsWith('d3-')) return 'charts';
      if (id.includes('/src/admin/')) return 'admin';
      return null; // leave placement to Bun
    },
  },
  routes,
});
```

Use it when you know something the bundler cannot: that two dependencies always load together, that a set of modules
should be one long-lived cache entry, or that a page's islands should share one file instead of several.

### The callback

`chunks` runs once per module in the built client graph.

- `id` — absolute path, always with forward slashes, so `id.includes('node_modules/chart.js/')` works on Windows too.
- `ctx.packageName` — `chart.js`, `@lucide/svelte`, or `null` for your own source. Set for both `node_modules` layouts,
  so it reads the same under either install linker.
- `ctx.isNodeModules` — whether the module came from a dependency.
- `ctx.relativeId` — `id` relative to the build directory.
- `ctx.bytes` — parsed size, for a size-driven rule.

Return a chunk name to place the module, or `null` to leave it to Bun. Names may contain letters, digits, `.`, `_` and
`-`. An invalid name, or a callback that throws, fails the build and names the module responsible.

### What ships

A chunk is fetched by every island that reaches **any** of its members, and a module you assign is no longer
tree-shaken against the islands importing it — the whole module ships. This is the same trade Vite's `manualChunks`
makes: you are choosing cache granularity over minimum bytes.

<Callout type="warning">

Group modules that are genuinely used together. Putting a rarely-used dependency in the same chunk as a common one
makes every island that needs the common one download both.

</Callout>

### Production only

<Callout type="info">

Chunking runs in **production only**. Assigning modules to chunks is a whole-graph decision that needs an extra
discovery build pass, and per-file hot reloading cannot reuse its result — the same reason
[`optimize`](/docs/svelte-shaker/) is production-only. In development the option is ignored and the bundle splits as it
normally does. Run `mochi-framework build` to see the chunked output.

</Callout>

`mochi-framework build` reads `clientBundle` straight from your entry's `Mochi.serve()` call and prints the chunks it
built, since a chunk is not visible anywhere else:

```
      Chunk       modules   size
  ┌ ▤ charts           14   88 kB
  └ ▤ admin             6   12 kB

  2 chunks · 100 kB
```

### Modules that are skipped

Some modules are left where Bun put them. Every one is named in the build report — nothing is skipped silently.

- **CommonJS.** Its export names are worked out during bundling, after the point Mochi has to declare them, so moving
  one would break any named import of it.
- **Svelte itself.** Every island reaches the Svelte runtime, so Bun already emits it as one shared chunk — there is
  nothing to gain. Moving it loses: the runtime's modules are densely circular, and relocating them reorders their
  initialization, which builds cleanly and then throws during hydration in the browser.

A group whose modules are all reached from a single island is not shared with anything, so Bun keeps them in that
island's own bundle. The report says so rather than listing a chunk that does not exist:

```
  no shared chunk: admin — its modules are reached from one island entry, which already carries them.
```

### Initialization order

Members of a chunk keep the order they ran in before you grouped them. What changes is where the group as a whole runs:
it initializes at the point the **first** of its members is reached, so a member that used to run late now runs there
too.

<Callout type="warning">

That shift is not something Mochi can check for you. If a grouped module runs code at import time that something
outside the chunk depends on having run first, the build succeeds and the failure appears only when the page hydrates.
After changing `chunks`, load a page that uses the affected islands in a real browser and check the console — a passing
build is not enough.

</Callout>

### Turning splitting off

```ts
clientBundle: {
  splitting: false;
}
```

Every island entry becomes self-contained: no shared chunks, no extra requests, and any dependency used by two islands
is duplicated into both. Worth measuring before adopting — it usually costs more bytes than it saves requests.

Shared chunks are exactly what splitting emits, so `splitting: false` and `chunks` cannot be combined — Mochi rejects
the pair at startup rather than running a classifier that has nothing to place.
