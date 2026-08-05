<script>
  import { isServer } from 'mochi-framework';
  import { delay } from '../../components/utils.ts';
  import DepthLevel4 from './DepthLevel4.svelte';

  let { inline = true } = $props();

  await (isServer ? delay(300, 600) : Promise.resolve());
</script>

<div class="level level-3">
  <p><strong>Level 3</strong> — server island (<code>mochi:defer</code>). It nests one more:</p>
  <DepthLevel4 mochi:defer={{ inline }}>
    <div class="island-loading">Loading level 4<span class="dots"></span></div>
  </DepthLevel4>
</div>

<style>
  .level {
    padding: 0.85rem 1rem;
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius-md);
    color: var(--text);
  }

  .level > p {
    margin: 0 0 0.6rem;
  }

  .level-3 {
    background: var(--surface-muted);
  }

  .island-loading {
    padding: 0.85rem;
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
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
