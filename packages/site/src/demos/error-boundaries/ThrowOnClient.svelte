<script lang="ts">
  import { isBrowser } from 'mochi-framework';
  import type { MochiDirectives } from 'mochi-framework';

  const props: { label?: string } & MochiDirectives = $props();

  if (isBrowser) {
    throw new Error(`Client throw from <${props.label ?? 'ThrowOnClient'}>`);
  }
</script>

<div class="card">
  This island renders fine on the server. Once the client tries to hydrate, the script throws synchronously — the boundary catches it and swaps in the failure stub.
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
