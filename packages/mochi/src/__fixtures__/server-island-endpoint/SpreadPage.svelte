<script lang="ts">
  import Echo from './Echo.svelte';

  let { extra = {} }: { extra?: Record<string, string> } = $props();
</script>

<Echo mochi:defer {...extra} secret="server-only-secret" />
<Echo mochi:defer:visible {...extra} secret="server-only-secret" />
