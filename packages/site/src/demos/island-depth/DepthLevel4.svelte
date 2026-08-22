<script>
  import { isServer } from 'mochi-framework';
  import { delay } from '../../components/utils.ts';

  let { inline = true } = $props();

  await (isServer ? delay(inline ? 300 : 600, inline ? 600 : 1200) : Promise.resolve());
</script>

<div class="level level-4">
  <p><strong>Level 4</strong> — deepest server island (<code>mochi:defer</code>). No more nesting below.</p>
</div>

<style>
  .level {
    padding: 0.85rem 1rem;
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius-md);
    color: var(--text);
  }

  .level p {
    margin: 0;
  }

  .level-4 {
    background: var(--badge-info-bg);
    border-color: var(--badge-info-text);
  }

  code {
    font-family: var(--font-mono);
  }
</style>
