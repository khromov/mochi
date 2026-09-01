<script lang="ts">
  import { onMount } from 'svelte';
  import type { MochiDirectives } from '../../islands/directives';

  // Renders nothing — its only job is to tell the debug bar, once this page loads,
  // which message is being read (viewedId) and which ids still exist (allIds), so the
  // toolbar can drop the read one from its unread set and prune ids that were cleared.
  let { viewedId, allIds }: { viewedId: string | null; allIds: string[] } & MochiDirectives = $props();

  onMount(() => {
    // A stale ?id= (e.g. the dev server restarted and cleared the outbox while
    // this tab stayed open) no longer matches any captured email — strip it and
    // reload so we land on the default selection instead of an empty detail pane.
    const url = new URL(location.href);
    const id = url.searchParams.get('id');
    if (id && !allIds.includes(id)) {
      url.searchParams.delete('id');
      location.replace(url.href);
      return;
    }

    dispatchEvent(new CustomEvent('mochi:outbox-sync', { detail: { viewedId, allIds } }));
  });
</script>
