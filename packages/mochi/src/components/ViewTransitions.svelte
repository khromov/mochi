<script lang="ts">
  import { getRequestContext, devWarn } from 'mochi-framework';
  import RawScript from './RawScript.svelte';
  import slugify from '../vendor/slugify/index.ts';

  let {
    type = 'fade',
    custom,
    duration = 250,
    easing = 'ease',
    regions,
    keepElementSelectors,
    isHydratable,
  }: {
    type?: 'fade' | 'slide' | 'scale' | 'blur' | 'flip';
    // Bring your own animation. `out`/`in` are the BODY of each keyframe (the
    // `from`/`to`/`%` rules); they're wrapped into `@keyframes` for you and
    // drive the leaving/entering snapshots. When set, this overrides `type`.
    custom?: { out?: string; in?: string };
    duration?: number;
    // The animation timing function applied to every transitioning snapshot.
    easing?: string;
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

  const locals = getRequestContext().locals;
  // __mochi_view_transitions__ is the internal key we use to track whether we've already rendered a <ViewTransitions /> for this page.
  const isFirst = !locals.__mochi_view_transitions__;
  if (isFirst) {
    locals.__mochi_view_transitions__ = true;
  } else {
    devWarn('<ViewTransitions /> was rendered more than once on this page — ignoring this instance. Render exactly one, typically from a shared layout.');
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
  // A custom `out`/`in` body overrides the chosen preset. Both sides are
  // optional, but at least one must be supplied; a missing side emits an empty
  // @keyframes so that direction simply doesn't animate.
  const keyframeCss = $derived.by(() => {
    if (custom == null) {
      return keyframes[type];
    }
    if (custom.out == null && custom.in == null) {
      throw new Error('<ViewTransitions /> custom requires at least an `out` or `in` keyframe body.');
    }
    for (const [side, body] of [
      ['out', custom.out],
      ['in', custom.in],
    ] as const) {
      // Bodies are interpolated into a raw <style> tag; a `<` could close it
      // and inject markup. Always developer-authored, so just refuse.
      if (body?.includes('<')) {
        throw new Error(`<ViewTransitions /> custom.${side} must not contain "<", got ${JSON.stringify(body)}.`);
      }
    }
    return `@keyframes mochi-vt-out { ${custom.out ?? ''} }
      @keyframes mochi-vt-in { ${custom.in ?? ''} }`;
  });

  const targets = $derived(regions == null ? ['root'] : Array.isArray(regions) ? regions : [regions]);

  const animationRules = $derived(
    targets
      .map(
        (name) =>
          `::view-transition-old(${name}) { animation: mochi-vt-out ${duration}ms ${easing} both; }
    ::view-transition-new(${name}) { animation: mochi-vt-in ${duration}ms ${easing} both; }`,
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
        // Collapse non-alphanumeric runs to spaces first so slugify treats CSS
        // symbols (`>`, `.`) as separators rather than transliterating them
        // (e.g. `>` → `greater`). `|| 'el'` covers selectors with no
        // alphanumerics at all (e.g. `*`), which would otherwise slug to empty.
        const slug = slugify(selector.replace(/[^a-z0-9]+/gi, ' '), { lower: true, strict: true }) || 'el';
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
  // the template, which svelte2tsx (svelte-check) mis-parses in markup. The
  // prop guards live here too so their reads sit inside a reactive closure.
  const styleTag = $derived.by(() => {
    if (isHydratable) {
      throw new Error('<ViewTransitions /> must not be hydrated — it emits static CSS only. Remove the mochi: directives.');
    }
    if (!Number.isFinite(duration) || duration < 0) {
      throw new Error(`<ViewTransitions /> duration must be a non-negative number of milliseconds, got ${JSON.stringify(duration)}.`);
    }
    // `easing` is interpolated into a raw <style> tag; a `<` could close it and
    // inject markup. Always developer-authored, so just refuse.
    if (easing.includes('<')) {
      throw new Error(`<ViewTransitions /> easing must not contain "<", got ${JSON.stringify(easing)}.`);
    }
    return `<style>@view-transition { navigation: auto; }${rootReset}
    ${animationRules}
    ${keepRules ? keepRules + '\n    ' : ''}${keyframeCss}
    @media (prefers-reduced-motion: reduce) {
      ${reducedTargets} { animation: none; }
    }</style>`;
  });
</script>

<svelte:head>
  {#if isFirst}
    <RawScript string={styleTag} />
  {/if}
</svelte:head>
