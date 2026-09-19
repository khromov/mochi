<script lang="ts">
  import Always from './Always.svelte';
  import Never from './Never.svelte';
  import Global from './Global.svelte';
  import VariantA from './VariantA.svelte';
  import VariantB from './VariantB.svelte';
  import Toggle from './Toggle.svelte';
  import Widget from './Widget.svelte';
  import Deferred from './Deferred.svelte';
  let { variant = 'a', islands = true }: { variant?: string; islands?: boolean } = $props();
</script>

<Always />
{#if variant === 'a'}
  <VariantA />
{:else}
  <VariantB />
{/if}
<!-- Runtime-false rather than a literal `false`, which the bundler would fold away along with the imports. -->
{#if variant === 'never'}
  <Never />
  <Global />
{/if}
{#if islands}
  <Toggle mochi:hydrate />
  <Widget mochi:clientOnly />
  <Deferred mochi:defer variant="b" />
{/if}
