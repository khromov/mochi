<script lang="ts">
  import RawScript from './RawScript.svelte';
  import { buildScriptModuleTag } from './buildScriptTag';

  let {
    src,
    scripts,
    isHydratable,
    __mochiScriptUrls,
  }: {
    // Path to a single client script, relative to this `.svelte` file (or absolute).
    src?: string;
    // Paths to multiple client scripts. Use instead of `src` for more than one.
    scripts?: string[];
    isHydratable?: boolean;
    // Injected by the preprocessor: the bundled, content-hashed URLs (as
    // placeholder tokens) for `src`/`scripts`. `src`/`scripts` themselves are
    // compile-time-only — read by the preprocessor, never at runtime.
    __mochiScriptUrls?: string[];
  } = $props();

  if (isHydratable) {
    throw new Error('<Script /> must not be hydrated — it emits a module script that loads its own bundle. Remove the mochi: directives.');
  }

  void src;
  void scripts;

  if (!__mochiScriptUrls || __mochiScriptUrls.length === 0) {
    throw new Error(
      '<Script /> requires a static `src` or `scripts` literal so the referenced files can be bundled at build time, e.g. <Script src="./app.ts" />. ' +
        'A dynamic path, or using <Script /> outside a Mochi-compiled component, is not supported.',
    );
  }

  // The placeholder tokens are replaced with the hashed bundle URLs by
  // ComponentRegistry after render, then inlined via RawScript (like
  // ViewTransitions). The tag string is built in a .ts helper to keep the
  // literal module-script markup out of this Svelte script block.
  const scriptTag = buildScriptModuleTag(__mochiScriptUrls);
</script>

<RawScript string={scriptTag} />
