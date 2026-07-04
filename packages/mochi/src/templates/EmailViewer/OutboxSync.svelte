<script lang="ts">
  import { onMount } from 'svelte';

  // Renders nothing — its only job is to tell the debug bar, once this page loads,
  // which message is being read (viewedId) and which ids still exist (allIds), so the
  // toolbar can drop the read one from its unread set and prune ids that were cleared.
  let { viewedId, allIds }: { viewedId: string | null; allIds: string[] } = $props();

  onMount(() => {
    dispatchEvent(new CustomEvent('mochi:outbox-sync', { detail: { viewedId, allIds } }));
  });
</script>
