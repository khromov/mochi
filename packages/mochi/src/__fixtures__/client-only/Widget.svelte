<script lang="ts">
  import type { Snippet } from 'svelte';

  // `children` is never passed at runtime (fallback children are an SSR-only
  // placeholder), but the original invocation still type-checks against the
  // component's props, so the type must allow it.
  let { label } = $props<{ label: string; children?: Snippet }>();
</script>

<div data-widget-rendered>{label}</div>

<style>
  [data-widget-rendered] {
    color: rebeccapurple;
  }
</style>
