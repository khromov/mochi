<script lang="ts">
  import { PortableText } from '@portabletext/svelte';
  import { unknown } from './blocks.ts';

  // The renderer reports missing components from an $effect, which never runs during SSR —
  // so this panel is an island; on the server the same value renders silently.
  let messages = $state<string[]>([]);

  function onMissingComponent(message: string, { type, nodeType }: { type: string; nodeType: string }) {
    const line = `${nodeType}: ${type} — ${message}`;
    if (!messages.includes(line)) {
      messages = [...messages, line];
    }
  }
</script>

<div class="missing">
  <div class="output">
    <PortableText value={unknown} {onMissingComponent} />
  </div>

  <ul>
    {#each messages as message (message)}
      <li>{message}</li>
    {:else}
      <li class="empty">Nothing reported yet.</li>
    {/each}
  </ul>
</div>

<style>
  .missing {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .output {
    padding: 0.1rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-muted);
    font-size: 0.9rem;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  li {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--text-muted);
    padding: 0.3rem 0.5rem;
    border-left: 2px solid var(--badge-warning-bg);
    background: var(--surface-muted);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  }

  .empty {
    border-left-color: var(--border);
    color: var(--text-subtle);
  }
</style>
