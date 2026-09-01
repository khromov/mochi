<script lang="ts">
  import { isBrowser } from 'mochi-framework';
  import type { MochiDirectives } from 'mochi-framework';

  const props: { label?: string } & MochiDirectives = $props();

  if (!isBrowser) {
    throw new Error(`SSR throw from <${props.label ?? 'ThrowOnSsr'}>`);
  }
</script>

<div class="card">
  On the server this island threw, so the boundary swapped in the failure stub — you briefly see it flash before hydration takes over, or if you disable JavaScript. Then the client
  re-renders the component cleanly and replaces the stub with this content. This works but is not recommended.
</div>

<style>
  .card {
    padding: 1rem 1.25rem;
    background: var(--surface-muted);
    border: 2px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text);
    font-size: 0.95rem;
  }
</style>
