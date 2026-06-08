<script lang="ts">
  import { SvelteMap } from 'svelte/reactivity';

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
    regions,
    keep,
  }: {
    type?: 'fade' | 'slide';
    duration?: number;
    // Confine the animation to elements carrying these `view-transition-name`s.
    // Omit to animate the whole page (the `root` snapshot). When given, the
    // unnamed remainder swaps instantly so only the named regions animate —
    // the caller is responsible for setting `view-transition-name` on them.
    regions?: string | string[];
    // CSS selectors for persistent chrome (banner, sidebar, …) to hold STILL
    // across navigations. Unlike `regions`, which takes names you've already
    // assigned, `keep` takes selectors and assigns each a stable name itself,
    // then freezes its group + snapshots so the element neither moves nor
    // fades. Render the same list on every page (i.e. from a shared layout) so
    // the outgoing and incoming pages agree on the names.
    keep?: string | string[];
  } = $props();

  const keyframes = {
    fade: `
      @keyframes mochi-vt-out { to { opacity: 0; } }
      @keyframes mochi-vt-in { from { opacity: 0; } }`,
    slide: `
      @keyframes mochi-vt-out { to { transform: translateX(-30px); opacity: 0; } }
      @keyframes mochi-vt-in { from { transform: translateX(30px); opacity: 0; } }`,
  } as const;

  const targets = $derived(regions == null ? ['root'] : Array.isArray(regions) ? regions : [regions]);

  const animationRules = $derived(
    targets
      .map(
        (name) =>
          `::view-transition-old(${name}) { animation: mochi-vt-out ${duration}ms ease both; }
    ::view-transition-new(${name}) { animation: mochi-vt-in ${duration}ms ease both; }`,
      )
      .join('\n    '),
  );

  // When confining to named regions, the unnamed remainder lives in `root`;
  // stop it cross-fading so only the regions animate.
  const rootReset = $derived(regions == null ? '' : `\n    ::view-transition-old(root), ::view-transition-new(root) { animation: none; }`);

  const reducedTargets = $derived([...new Set([...targets, 'root'])].map((name) => `::view-transition-old(${name}), ::view-transition-new(${name})`).join(', '));

  // Each kept selector gets a deterministic, ident-safe name derived from the
  // selector itself (not its index) so names stay stable when the list is
  // reordered and read cleanly in devtools; a per-slug counter disambiguates
  // the rare case where two selectors sanitize to the same slug.
  const keepRules = $derived.by(() => {
    const selectors = keep == null ? [] : Array.isArray(keep) ? keep : [keep];
    const seen = new SvelteMap<string, number>();
    return selectors
      .map((selector) => {
        const slug = selector
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
        const n = seen.get(slug) ?? 0;
        seen.set(slug, n + 1);
        const name = `mochi-vt-keep-${slug}${n ? `-${n}` : ''}`;
        // Freeze group + old + new — the group keeps the box from sliding or
        // resizing, old/new keep it from cross-fading.
        return `${selector} { view-transition-name: ${name}; }
    ::view-transition-group(${name}),
    ::view-transition-old(${name}),
    ::view-transition-new(${name}) { animation: none; }`;
      })
      .join('\n    ');
  });

  // Build the full <style> tag here rather than in the markup: svelte2tsx
  // (svelte-check) mis-parses a literal `</style>` inside a markup `{@html}`
  // expression, but in the script it's just string data.
  const styleTag = $derived(
    `<style>@view-transition { navigation: auto; }${rootReset}
    ${animationRules}
    ${keepRules ? keepRules + '\n    ' : ''}${keyframes[type]}
    @media (prefers-reduced-motion: reduce) {
      ${reducedTargets} { animation: none; }
    }</style>`,
  );
</script>

<svelte:head>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- framework-generated CSS from a fixed enum, numeric duration, and developer-authored selectors/names (layout props, never end-user input) -->
  {@html styleTag}
</svelte:head>
