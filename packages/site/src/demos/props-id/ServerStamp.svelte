<script lang="ts">
  import Field from './Field.svelte';
  import type { MochiDirectives } from 'mochi-framework';

  let {}: MochiDirectives = $props();
</script>

<Field>
  <p>Rendered on demand in a separate request 🏝️</p>
</Field>

<style>
  p {
    margin: 0;
  }
</style>
