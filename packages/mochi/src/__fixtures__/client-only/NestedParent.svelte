<script lang="ts">
  import Widget from './Widget.svelte';
</script>

<div data-nested-parent>
  <Widget mochi:clientOnly label="nested" />
</div>
