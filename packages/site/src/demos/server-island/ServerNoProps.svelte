<script>
  import { isServer } from 'mochi-framework';
  import { delay } from '../../components/utils.ts';

  let { islandId } = $props();

  await (isServer ? delay(1000, 3000) : Promise.resolve());

  const randomNumber = Math.floor(Math.random() * 1000);
</script>

<div class="server-no-props">
  <p>Server island without props</p>
  <p class="number">Random number generated on server: <strong>{randomNumber}</strong></p>
  <p class="island-id">Island ID: <strong>{islandId}</strong></p>
</div>

<style>
  .server-no-props {
    padding: 1rem 1.1rem;
    border: 2px dashed var(--badge-warning-text);
    border-radius: var(--radius-md);
    background: var(--badge-warning-bg);
    color: var(--text);
    margin-top: 0.75rem;
  }

  .server-no-props p {
    margin: 0 0 0.35rem;
  }

  .server-no-props p:last-child {
    margin-bottom: 0;
  }

  .number,
  .island-id {
    font-size: 0.92em;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
</style>
