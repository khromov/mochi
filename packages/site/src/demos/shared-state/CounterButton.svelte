<script lang="ts">
  import { getLikes, like } from '../../stores/likes.svelte.ts';
</script>

<button class="counter-btn" onclick={like}>
  <span class="counter-label">♥ Likes</span>
  <span class="counter-value">{getLikes() ?? 0}</span>
</button>

<style>
  .counter-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.75rem 1.25rem;
    background: var(--surface-muted);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-family: inherit;
    font-size: 1.1rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      color 0.12s ease;
  }

  .counter-btn:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-soft-text);
  }

  .counter-btn:active {
    transform: translateY(1px);
  }

  .counter-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .counter-label {
    color: var(--text-muted);
    font-size: 1rem;
  }

  .counter-btn:hover .counter-label {
    color: inherit;
  }

  .counter-value {
    background: var(--accent-soft);
    color: var(--accent-soft-text);
    border-radius: 999px;
    padding: 0.1rem 0.7rem;
    font-size: 1.1rem;
    font-weight: 700;
    min-width: 1.8rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .counter-btn:hover .counter-value {
    background: var(--surface);
  }
</style>
