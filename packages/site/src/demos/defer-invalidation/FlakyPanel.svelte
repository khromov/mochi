<script>
  import { isServer } from 'mochi-framework';
  import { delay } from '../../components/utils.ts';
  import FlakyContent from './FlakyContent.svelte';

  let { label = '' } = $props();

  await (isServer ? delay(700, 1300) : Promise.resolve());
</script>

<svelte:boundary>
  <FlakyContent {label} />

  {#snippet failed(error)}
    <div class="failed">
      <span class="label">{label}</span>
      <span class="value">failed — {error.message}</span>
    </div>
  {/snippet}
</svelte:boundary>

<style>
  .failed {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    min-height: 3.5rem;
    padding: 0.9rem 1rem;
    border: 2px dashed var(--badge-danger-text, #c00);
    border-radius: var(--radius-md);
    background: var(--badge-danger-bg, #fff5f5);
    color: var(--text);
  }

  .label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .value {
    font-size: 0.9rem;
    font-family: var(--font-mono);
    color: var(--badge-danger-text, #c00);
  }
</style>
