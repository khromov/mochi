<script lang="ts">
  // `isHydratable` is auto-injected as a prop on hydratable children;
  // plain SSR-only invocations leave it undefined.
  let { isHydratable }: { isHydratable?: boolean } = $props();
</script>

<span data-hydratable={String(isHydratable === true)}>probe</span>
