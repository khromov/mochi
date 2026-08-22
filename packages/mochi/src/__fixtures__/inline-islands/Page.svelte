<script lang="ts">
  import Chain from './Chain.svelte';
  import OptOutChain from './OptOutChain.svelte';
  import ThrowChain from './ThrowChain.svelte';
  import Recursive from './Recursive.svelte';
  import DeepHydrateTop from './DeepHydrateTop.svelte';
</script>

<h1>inline islands fixture</h1>
<Chain mochi:defer cond={true} />
<OptOutChain mochi:defer />
<ThrowChain mochi:defer />
<Recursive mochi:defer depth={0} />
<DeepHydrateTop mochi:defer mochi:hydrate />
