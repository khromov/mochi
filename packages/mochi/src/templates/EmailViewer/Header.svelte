<script lang="ts">
  let { count }: { count: number } = $props();
</script>

<header class="topbar">
  <div class="brand">
    <span class="mark">🍡</span>
    <span class="wordmark">mochi <em>outbox</em></span>
    <span class="dev-pill">dev</span>
  </div>
  <div class="topbar-actions">
    <span class="count">{count} captured</span>
    {#if count > 0}
      <form method="POST" action="?/clear" class="clear-form">
        <button type="submit" name="clear" class="clear-btn">Clear</button>
      </form>
    {/if}
  </div>
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    padding: 0.4rem 0.2rem 1rem;
    border-bottom: 1px solid var(--ev-border);
    margin-bottom: 1.25rem;
  }
  .brand {
    display: inline-flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  .mark {
    font-size: 1.35rem;
    line-height: 1;
  }
  .wordmark {
    font-family: var(--ev-font-serif);
    font-size: 1.25rem;
    font-weight: 500;
    color: var(--ev-text);
    letter-spacing: -0.01em;
  }
  .wordmark em {
    font-style: normal;
    color: var(--ev-accent);
  }
  .dev-pill {
    align-self: center;
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--ev-accent-soft-text);
    background: var(--ev-accent-soft);
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
  }
  .topbar-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.85rem;
  }
  .count {
    font-size: 0.78rem;
    color: var(--ev-text-subtle);
    font-family: var(--ev-font-mono);
    font-variant-numeric: tabular-nums;
  }
  .clear-form {
    margin: 0;
  }
  .clear-btn {
    appearance: none;
    font-family: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--ev-text-muted);
    background: var(--ev-surface);
    border: 1px solid var(--ev-border-strong);
    border-radius: var(--ev-radius-sm);
    padding: 0.35rem 0.8rem;
    cursor: pointer;
    transition:
      color 0.14s ease,
      border-color 0.14s ease,
      background 0.14s ease;
  }
  .clear-btn:hover {
    color: #7a2e20;
    border-color: #d8a99e;
    background: #f7e7e1;
  }
</style>
