<script lang="ts">
  import { getRequestContext, devWarn } from 'mochi-framework';
  import RawScript from './RawScript.svelte';

  let {
    type = 'fade',
    duration = 250,
    regions,
    keepElementSelectors,
    isHydratable,
  }: {
    type?: 'fade' | 'slide' | 'scale' | 'blur' | 'flip';
    duration?: number;
    // Confine the animation to elements carrying these `view-transition-name`s.
    // Omit to animate the whole page (the `root` snapshot). When given, the
    // unnamed remainder swaps instantly so only the named regions animate —
    // the caller is responsible for setting `view-transition-name` on them.
    regions?: string | string[];
    // CSS selectors for persistent chrome (banner, sidebar, …) to hold STILL
    // across navigations.
    keepElementSelectors?: string | string[];
    // Injected by the framework on island invocations (mochi:hydrate*/defer*).
    isHydratable?: boolean;
  } = $props();

  if (isHydratable) {
    throw new Error('<ViewTransitions /> must not be hydrated — it emits static CSS only. Remove the mochi: directives.');
  }

  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error(`<ViewTransitions /> duration must be a non-negative number of milliseconds, got ${JSON.stringify(duration)}.`);
  }

  let isFirst = true;
  const locals = getRequestContext().locals;
  // __mochi_view_transitions__ is the internal key we use to track whether we've already rendered a <ViewTransitions /> for this page.
  if (locals.__mochi_view_transitions__) {
    devWarn('<ViewTransitions /> was rendered more than once on this page — ignoring this instance. Render exactly one, typically from a shared layout.');
    isFirst = false;
  } else {
    locals.__mochi_view_transitions__ = true;
  }

  const keyframes = {
    fade: `
      @keyframes mochi-vt-out { to { opacity: 0; } }
      @keyframes mochi-vt-in { from { opacity: 0; } }`,
    slide: `
      @keyframes mochi-vt-out { to { transform: translateX(-30px); opacity: 0; } }
      @keyframes mochi-vt-in { from { transform: translateX(30px); opacity: 0; } }`,
    scale: `
      @keyframes mochi-vt-out { to { transform: scale(0.92); opacity: 0; } }
      @keyframes mochi-vt-in { from { transform: scale(1.08); opacity: 0; } }`,
    blur: `
      @keyframes mochi-vt-out { to { filter: blur(6px); opacity: 0; } }
      @keyframes mochi-vt-in { from { filter: blur(6px); opacity: 0; } }`,
    flip: `
      @keyframes mochi-vt-out { to { transform: perspective(1200px) rotateY(-90deg); opacity: 0; } }
      @keyframes mochi-vt-in { from { transform: perspective(1200px) rotateY(90deg); opacity: 0; } }`,
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
    const selectors = keepElementSelectors == null ? [] : Array.isArray(keepElementSelectors) ? keepElementSelectors : [keepElementSelectors];
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local scratch state rebuilt on every evaluation of this derived; nothing reactive escapes it
    const seen = new Map<string, number>();
    return selectors
      .map((selector) => {
        // Selectors are interpolated into a raw <style> tag; a `<` could close
        // it and inject markup. Always developer-authored, so just refuse.
        if (selector.includes('<')) {
          throw new Error(`<ViewTransitions /> keepElementSelectors must not contain "<", got ${JSON.stringify(selector)}.`);
        }
        // `|| 'el'` covers selectors with no alphanumerics at all (e.g. `*`),
        // which would otherwise slug to an empty string.
        const slug =
          selector
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'el';
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

  // Assemble the full <style> tag as a string and hand it to <RawScript /> to
  // inline. Building it here (not in markup) keeps the literal `</style>` out of
  // the template, which svelte2tsx (svelte-check) mis-parses in markup.
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
  {#if isFirst}
    <RawScript string={styleTag} />
  {/if}
</svelte:head>
