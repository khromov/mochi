<script lang="ts">
  import { onMount } from 'svelte';

  let { sentAt }: { sentAt: number } = $props();

  function relTime(ts: number, nowMs: number): string {
    const s = Math.max(0, Math.round((nowMs - ts) / 1000));
    if (s < 60) {
      return 'just now';
    }
    const m = Math.floor(s / 60);
    if (m < 60) {
      return `${m}m ago`;
    }
    const h = Math.floor(m / 60);
    if (h < 24) {
      return `${h}h ago`;
    }
    return `${Math.floor(h / 24)}d ago`;
  }

  let now = $state(Date.now());
  const label = $derived(relTime(sentAt, now));

  // Re-stamp once a minute so the relative label stays fresh without a reload.
  onMount(() => {
    const id = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(id);
  });
</script>

{label}
