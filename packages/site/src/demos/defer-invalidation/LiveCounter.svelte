<script>
  import { isServer } from 'mochi-framework';
  import { delay } from '../../components/utils.ts';

  await (isServer ? delay(150, 400) : Promise.resolve());

  const mintedAt = new Date().toLocaleTimeString();
  let count = $state(0);
</script>

<div class="counter">
  <div class="meta">
    <span class="label">Hydrated defer</span>
    <span class="minted">minted {mintedAt}</span>
  </div>
  <button onclick={() => count++}>Clicked {count} {count === 1 ? 'time' : 'times'}</button>
</div>

<style>
  .counter {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.9rem 1rem;
    border: 2px solid var(--badge-info-text);
    border-radius: var(--radius-md);
    background: var(--badge-info-bg);
    color: var(--text);
  }

  .meta {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .minted {
    font-size: 0.8rem;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
  }

  button {
    padding: 0.5rem 0.9rem;
    border: none;
    border-radius: var(--radius-md);
    background: var(--badge-info-text);
    color: var(--badge-info-bg);
    font-weight: 600;
    cursor: pointer;
  }
</style>
