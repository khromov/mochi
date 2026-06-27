<script lang="ts">
  import type { ClientOnlyProps } from 'mochi-framework';

  let { label = 'Lazy island' }: ClientOnlyProps<{ label?: string }> = $props();

  // `performance.now()` at the top level captures the moment this component
  // mounts in the browser — a client-only concept with no SSR equivalent.
  const mountedAt = performance.now();
  let seconds = $state(0);

  $effect(() => {
    const id = setInterval(() => {
      seconds = Math.floor((performance.now() - mountedAt) / 1000);
    }, 1000);
    return () => clearInterval(id);
  });
</script>

<div class="probe">
  <span class="dot"></span>
  {label}: mounted on scroll <strong>{seconds}s</strong> ago.
</div>

<style>
  .probe {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem;
    font-size: 0.9rem;
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--accent);
    flex: none;
  }
</style>
