<script lang="ts">
  import { isBrowser } from 'mochi-framework';

  let message = $state('');

  async function reroll() {
    if (!isBrowser) {
      return;
    }
    const res = await fetch('/api/feature-flags/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const json = (await res.json()) as { ok: boolean };
    if (json.ok) {
      message = 'Assignment cleared — reloading…';
      location.reload();
    }
  }
</script>

<div class="reset">
  <button onclick={reroll}>Re-roll my assignment</button>
  {#if message}
    <p class="message">{message}</p>
  {/if}
</div>

<style>
  .reset {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  button {
    padding: 0.5rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    color: var(--text);
    font-family: inherit;
    font-size: 0.95rem;
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      color 0.12s ease;
  }

  button:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-soft-text);
  }

  button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .message {
    font-size: 0.95rem;
    color: var(--badge-success-text);
    font-weight: 500;
  }
</style>
