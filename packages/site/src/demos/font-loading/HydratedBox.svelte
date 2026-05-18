<script lang="ts">
  import '@fontsource/lobster-two';
  import { isBrowser } from 'mochi-framework';
  import Badge from '../../components/Badge.svelte';
</script>

<div class="box" class:hydrated={isBrowser}>
  <div class="header">
    <span class="title">Hydrated island</span>
    <Badge kind={isBrowser ? 'success' : 'info'}>
      {isBrowser ? 'hydrated' : 'server-rendered only'}
    </Badge>
  </div>
  <p class="display">Lobster Two ships with this island.</p>
</div>

<style>
  .box {
    margin-top: 1.5rem;
    padding: 1.25rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    transition: border-color 200ms ease;
  }
  .box.hydrated {
    border-color: var(--success, #59c08a);
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }
  .title {
    font-weight: 600;
  }
  .display {
    font-family: 'Lobster Two', cursive;
    font-size: 1.75rem;
    margin: 0.5rem 0 0;
  }
</style>
