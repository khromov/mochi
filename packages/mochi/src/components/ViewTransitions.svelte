<script lang="ts">
  // Zero-JS cross-document view transitions: opting into `@view-transition`
  // makes the browser animate full-page navigations for us. Mochi is an MPA, so
  // there's no client router to hook — both the page you leave and the page you
  // land on just need this rule in their <head>, which is why this belongs in a
  // shared layout rendered on every page. Animations target the `root` snapshot
  // so they apply to any page with no per-element `view-transition-name` setup.
  // The CSS is emitted as a raw <style> string rather than a scoped component
  // <style> block: the `::view-transition-*` pseudo-elements are document-global
  // and bound to no element here, so Svelte's CSS scoper would prune them.

  let {
    type = 'fade',
    duration = 250,
  }: {
    type?: 'fade' | 'slide';
    duration?: number;
  } = $props();

  const keyframes = {
    fade: `
      @keyframes mochi-vt-out { to { opacity: 0; } }
      @keyframes mochi-vt-in { from { opacity: 0; } }`,
    slide: `
      @keyframes mochi-vt-out { to { transform: translateX(-30px); opacity: 0; } }
      @keyframes mochi-vt-in { from { transform: translateX(30px); opacity: 0; } }`,
  } as const;

  // Build the full <style> tag here rather than in the markup: svelte2tsx
  // (svelte-check) mis-parses a literal `</style>` inside a markup `{@html}`
  // expression, but in the script it's just string data.
  const styleTag = $derived(
    `<style>@view-transition { navigation: auto; }
    ::view-transition-old(root) { animation: mochi-vt-out ${duration}ms ease both; }
    ::view-transition-new(root) { animation: mochi-vt-in ${duration}ms ease both; }
    ${keyframes[type]}
    @media (prefers-reduced-motion: reduce) {
      ::view-transition-old(root), ::view-transition-new(root) { animation: none; }
    }</style>`,
  );
</script>

<svelte:head>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- framework-generated CSS from a fixed enum + numeric duration, no user HTML -->
  {@html styleTag}
</svelte:head>
