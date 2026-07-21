<script lang="ts">
  import type { ClientOnlyProps } from '../../index';

  let { label }: ClientOnlyProps<{ label: string }> = $props();
</script>

<div data-widget-rendered>{label}</div>

<style>
  [data-widget-rendered] {
    color: rebeccapurple;
  }
</style>
