<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { MochiDirectives } from 'mochi-framework';

  // children is the loading-state snippet shown until the server island
  // resolves (or, in this demo, fails) — declared so call sites can pass it.
  let { label = 'ThrowOnServerIsland', children: _children }: { label?: string; children?: Snippet } & MochiDirectives = $props();

  // Used as a `mochi:defer` target: the throw is caught by the server-island endpoint's try/catch,
  // which returns a 200 + island-failure stub so the client doesn't burn its retry budget.
  // svelte-ignore state_referenced_locally
  throw new Error(`Server-island throw from <${label}>`);
</script>

<div>never rendered</div>
