<script lang="ts">
  import CaptchaShot from './subjects/CaptchaShot.svelte';

  let { name, width, height, props }: { name: string; width: number; height: number; props: Record<string, unknown> } = $props();
</script>

<div class="shot" style="width: {width}px; height: {height}px">
  <!-- Branched rather than dispatched through a component map: the island preprocessor
       reads the directive off a static invocation of a relatively-imported component,
       so a dynamic <Subject /> would render SSR-only and never hydrate. Each subject in
       registry.ts needs a branch here. -->
  {#if name === 'captcha'}
    <CaptchaShot mochi:hydrate {...props} />
  {/if}
</div>

<style>
  /* The frame is the screenshot: exact pixels, pinned to the top-left corner so a
     viewport of the same size captures it edge-to-edge with nothing else in view. */
  .shot {
    position: fixed;
    inset: 0 auto auto 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    background: var(--bg);
    overflow: hidden;
  }

  /* The dev toolbar would otherwise sit across the bottom of every shot. This page's
     CSS only ships with this page, so a bare global rule can't leak to the site. */
  :global(#mochi-dev-toolbar) {
    display: none;
  }
</style>
