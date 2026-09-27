<script lang="ts">
  // Loaded through a dynamic `import()` so the split chunk it lives in is fetched at runtime, not at hydration.
  let loaded = $state('pending');

  $effect(() => {
    void import('./plain/lazyChunk.js').then((m) => {
      loaded = m.lazyValue;
    });
  });
</script>

<output data-testid="lazy-island">{loaded}</output>
