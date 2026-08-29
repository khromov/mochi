<script lang="ts">
  import RawScript from './RawScript.server.svelte';
  import { isHydratable } from 'mochi-framework';
  import { buildScriptModuleTag } from './buildScriptTag';

  // `src` / `scripts` are compile-time-only: the preprocessor reads their static literals, strips them, and injects
  // `__mochiScriptUrls` in their place, so they are declared for the authoring type but never read at runtime.
  let props: {
    src?: string;
    scripts?: string[];
    __mochiScriptUrls?: string[];
  } = $props();

  // Captured at init (getContext constraint); also fires when nested inside a hydrating island.
  const hydratable = isHydratable();

  const scriptTag = $derived.by(() => {
    if (hydratable) {
      throw new Error('<Script /> must not be hydrated — it emits a module script that loads its own bundle. Remove the mochi: directives.');
    }
    if (!props.__mochiScriptUrls || props.__mochiScriptUrls.length === 0) {
      throw new Error(
        '<Script /> requires a static `src` or `scripts` literal so the referenced files can be bundled at build time, e.g. <Script src="./app.ts" />. ' +
          'A dynamic path, or using <Script /> outside a Mochi-compiled component, is not supported.',
      );
    }
    return buildScriptModuleTag(props.__mochiScriptUrls);
  });
</script>

<RawScript string={scriptTag} />
