<script lang="ts">
  import { onMount } from 'svelte';

  let stamp = $state<string | null>(null);

  onMount(() => {
    stamp = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
  });
</script>

<span class="stamp" class:stamp-on={stamp}>{stamp ? `hydrated at ${stamp}` : 'not hydrated yet'}</span>
