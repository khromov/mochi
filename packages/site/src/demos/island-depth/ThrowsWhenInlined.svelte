<script>
  import { getRequestContext } from 'mochi-framework';

  const { url } = getRequestContext();
  if (!url.pathname.includes('/island/ThrowsWhenInlined')) {
    throw new Error('ThrowsWhenInlined: failing the inline attempt');
  }
</script>

<div class="recovered">
  <p><strong>ThrowsWhenInlined</strong> — threw during the inline attempt, degraded to a placeholder, and its own fetch succeeded.</p>
</div>

<style>
  .recovered {
    padding: 0.85rem 1rem;
    border: 2px dashed var(--badge-info-text);
    border-radius: var(--radius-md);
    background: var(--badge-info-bg);
    color: var(--text);
  }

  .recovered p {
    margin: 0;
  }
</style>
