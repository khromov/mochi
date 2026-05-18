<script lang="ts">
  type BadgeKind = 'default' | 'info' | 'success' | 'warning' | 'danger';

  let { kind = 'default', children }: { kind?: BadgeKind; children: import('svelte').Snippet } = $props();
</script>

<span class="badge {kind}">{@render children()}</span>

<style>
  .badge {
    font-size: 0.65rem;
    font-weight: 600;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    background: var(--badge-default-bg);
    color: var(--badge-default-text);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }

  .badge.success {
    background: var(--badge-success-bg);
    color: var(--badge-success-text);
  }

  .badge.warning {
    background: var(--badge-warning-bg);
    color: var(--badge-warning-text);
  }

  .badge.info {
    background: var(--badge-info-bg);
    color: var(--badge-info-text);
  }

  .badge.danger {
    background: var(--badge-danger-bg);
    color: var(--badge-danger-text);
  }
</style>
