<script>
  import { isServer } from 'mochi-framework';
  import { delay } from '../../components/sourceUtils';
  import InnerServer from './InnerServer.svelte';
  import HydratedServer from './HydratedServer.svelte';

  await (isServer ? delay(800, 1500) : Promise.resolve());
</script>

<div class="defer-box">
  <p>Outer server island (<code>mochi:defer</code>). It nests two more islands:</p>
  <InnerServer mochi:defer label="Inner server island">
    <div class="island-loading">Loading inner server island<span class="dots"></span></div>
  </InnerServer>
  <HydratedServer mochi:defer mochi:hydrate label="Inner hydrated server island">
    <div class="island-loading">Loading hydrated server island<span class="dots"></span></div>
  </HydratedServer>
</div>

<style>
  .defer-box {
    padding: 1rem 1.1rem;
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    color: var(--text);
  }

  .defer-box > p {
    margin: 0 0 0.6rem;
  }

  .island-loading {
    margin-top: 0.6rem;
    padding: 0.85rem;
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    color: var(--text-subtle);
    font-style: italic;
    text-align: center;
  }

  .dots::after {
    content: '';
    display: inline-block;
    width: 1.5em;
    text-align: left;
    animation: dots 1.2s steps(4, end) infinite;
  }

  code {
    font-family: var(--font-mono);
  }

  @keyframes dots {
    0% {
      content: '';
    }
    25% {
      content: '.';
    }
    50% {
      content: '..';
    }
    75% {
      content: '...';
    }
  }
</style>
