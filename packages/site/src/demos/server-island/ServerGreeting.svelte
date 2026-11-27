<script>
  import { cookies, isServer } from 'mochi-framework';
  import { delay } from '../../components/sourceUtils';

  let { name = 'World', bigProp = '' } = $props();
  const islandId = $props.id();

  await (isServer ? delay(1000, 3000) : Promise.resolve());

  const username = cookies.get('mochi_username');
  // svelte-ignore state_referenced_locally
  let displayName = username ?? name;

  const renderedAt = new Date().toLocaleTimeString();
  let mouseX = $state(0);
  let mouseY = $state(0);
</script>

<svelte:window
  onmousemove={(e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  }}
/>

<div class="server-greeting">
  <p>Hello, <strong>{displayName}</strong>! 🏝️</p>
  <p class="timestamp">Rendered at {renderedAt}</p>
  <p class="timestamp">Mouse position: {mouseX}, {mouseY}</p>

  <p class="timestamp">$props.id(): {islandId}</p>
  <p class="timestamp">bigProp: {bigProp}</p>
  <p class="timestamp">bigProp length: {bigProp.length}</p>
</div>

<style>
  .server-greeting {
    padding: 1rem 1.1rem;
    border: 2px dashed var(--badge-info-text);
    border-radius: var(--radius-md);
    background: var(--badge-info-bg);
    color: var(--text);
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .server-greeting p {
    margin: 0 0 0.35rem;
  }

  .server-greeting p:last-child {
    margin-bottom: 0;
  }

  .timestamp {
    font-size: 0.92em;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
</style>
