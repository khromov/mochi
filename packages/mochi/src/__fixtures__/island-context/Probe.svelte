<script lang="ts">
  // `isHydratable` is auto-injected as a prop on hydratable children
  // (alongside `islandId`); plain SSR-only invocations leave it undefined.
  let { isHydratable } = $props<{ isHydratable?: boolean }>();
</script>

<span data-hydratable={String(isHydratable === true)}>probe</span>
