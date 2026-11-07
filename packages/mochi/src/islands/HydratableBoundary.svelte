<script>
  import { setContext } from 'svelte';

  // Interned via `Symbol.for` (same key as islands/isHydratable.ts) so the
  // seeded slot resolves across every bundled copy of the framework without
  // this component needing a framework import of its own.
  setContext(Symbol.for('mochi:hydratable'), true);
  let { children } = $props();
</script>

{@render children?.()}
