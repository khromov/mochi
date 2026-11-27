<script>
  import { isServer } from 'mochi-framework';
  import { delay } from '../../components/sourceUtils';
  import Counter from './Counter.svelte';

  await (isServer ? delay(800, 1500) : Promise.resolve());

  const renderedAt = new Date().toLocaleTimeString();
</script>

<div class="defer-box">
  <p>Server island (<code>mochi:defer</code>), rendered at {renderedAt}.</p>
  <p>It contains three independently hydrated counters — click them:</p>
  <div class="row">
    <Counter mochi:hydrate label="Alpha" />
    <Counter mochi:hydrate label="Beta" />
    <Counter mochi:hydrate label="Gamma" />
  </div>
</div>

<style>
  .defer-box {
    padding: 1rem 1.1rem;
    border: 2px dashed var(--badge-info-text);
    border-radius: var(--radius-md);
    background: var(--badge-info-bg);
    color: var(--text);
  }

  .defer-box p {
    margin: 0 0 0.5rem;
  }

  .row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  code {
    font-family: var(--font-mono);
  }
</style>
