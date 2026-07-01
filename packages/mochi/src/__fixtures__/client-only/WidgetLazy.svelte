<script lang="ts">
  import type { ClientOnlyProps } from '../../index';

  let { label }: ClientOnlyProps<{ label: string }> = $props();
</script>

<div data-widget-lazy-rendered>{label}</div>

<style>
  [data-widget-lazy-rendered] {
    color: teal;
  }
</style>
