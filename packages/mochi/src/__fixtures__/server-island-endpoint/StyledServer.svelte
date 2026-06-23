<script lang="ts">
  import StyledChild from './StyledChild.svelte';
</script>

<div class="styled-server">
  <StyledChild mochi:hydrate label="hi" />
</div>

<style>
  .styled-server {
    background: papayawhip;
  }
</style>
