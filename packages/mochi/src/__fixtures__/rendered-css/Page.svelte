<script lang="ts">
  import Always from './Always.svelte';
  import Never from './Never.svelte';
  import Global from './Global.svelte';
  import VariantA from './VariantA.svelte';
  import VariantB from './VariantB.svelte';
  import Toggle from './Toggle.svelte';
  import Widget from './Widget.svelte';
  import Deferred from './Deferred.svelte';
  import DeferredFallback from './DeferredFallback.svelte';
  import Loader from './Loader.svelte';
  import Shared from './Shared.svelte';
  import Hidden from './Hidden.svelte';
  let { variant = 'a', islands = true }: { variant?: string; islands?: boolean } = $props();
</script>

<Always />
<Shared />
{#if variant === 'a'}
  <VariantA />
{:else}
  <VariantB />
{/if}
<!-- Runtime-false rather than a literal `false`, which the bundler would fold away along with the imports. -->
{#if variant === 'never'}
  <Never />
  <Global />
  <Shared mochi:hydrate />
  <Hidden mochi:hydrate />
{/if}
{#if islands}
  <Toggle mochi:hydrate />
  <Widget mochi:clientOnly />
  <Loader mochi:hydrate />
  <Deferred mochi:defer variant="b"><DeferredFallback /></Deferred>
{/if}
