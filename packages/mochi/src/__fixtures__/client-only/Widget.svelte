<script lang="ts">
  let { label } = $props<{ label: string }>();
</script>

<div data-widget-rendered>{label}</div>

<style>
  [data-widget-rendered] {
    color: rebeccapurple;
  }
</style>
