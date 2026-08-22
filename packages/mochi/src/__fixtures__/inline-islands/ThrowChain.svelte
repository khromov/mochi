<script lang="ts">
  import Throwing from './Throwing.svelte';
</script>

<p data-marker="throw-chain">throw chain top</p>
<Throwing mochi:defer><em data-marker="throw-fallback">loading throwing child</em></Throwing>
