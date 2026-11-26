<script lang="ts">
  import Label from './Label.svelte';
  import Wrap from './Wrap.svelte';
</script>

<Wrap mochi:defer />
<Label mochi:hydrate:visible label="PAGE" />
