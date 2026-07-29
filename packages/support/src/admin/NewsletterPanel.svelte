<script lang="ts">
  import SubscriberRow from './SubscriberRow.svelte';
  import type { NewsletterLogEntry, Subscriber } from '../db.server';

  let { subscribers, logs }: { subscribers: Subscriber[]; logs: Record<number, NewsletterLogEntry[]> } = $props();

  const counts = $derived({
    confirmed: subscribers.filter((s) => s.status === 'confirmed').length,
    pending: subscribers.filter((s) => s.status === 'pending').length,
    unsubscribed: subscribers.filter((s) => s.status === 'unsubscribed').length,
  });
</script>

<section>
  <h2>
    Newsletter <span class="count">{counts.confirmed}</span>
    <span class="sub">{counts.pending} pending · {counts.unsubscribed} unsubscribed</span>
  </h2>
  {#if subscribers.length === 0}
    <p class="empty">No signups yet. The widget is embedded at the bottom of every blog post.</p>
  {:else}
    <div class="list">
      {#each subscribers as subscriber (subscriber.id)}
        <SubscriberRow {subscriber} log={logs[subscriber.id] ?? []} />
      {/each}
    </div>
  {/if}
</section>

<style>
  /* Repeated from Admin.svelte rather than inherited — Svelte scopes styles to the
     component that declares the markup. */
  h2 {
    font-family: var(--font-serif);
    font-size: 1.5rem;
    font-weight: 500;
    margin: 2rem 0 1rem;
  }

  .count {
    display: inline-block;
    font-family: var(--font-sans);
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-soft-text);
    vertical-align: middle;
  }

  .empty {
    color: var(--text-subtle);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .sub {
    font-family: var(--font-sans);
    font-size: 0.85rem;
    font-weight: 400;
    color: var(--text-subtle);
    margin-left: 0.5rem;
  }
</style>
