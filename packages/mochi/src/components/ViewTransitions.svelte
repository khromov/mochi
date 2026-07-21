<script lang="ts">
  import { getRequestContext, devWarn, isHydratable } from 'mochi-framework';
  import RawScript from './RawScript.svelte';
  import slugify from '../vendor/slugify/index.ts';

  let {
    type = 'fade',
    custom,
    duration = 250,
    easing = 'ease',
    regions,
    keepElementSelectors,
  }: {
    type?: 'fade' | 'slide' | 'scale' | 'blur' | 'flip';
    // The BODY of each keyframe (the `from`/`to`/`%` rules); overrides `type`.
    custom?: { out?: string; in?: string };
    duration?: number;
    easing?: string;
    regions?: string | string[];
    keepElementSelectors?: string | string[];
  } = $props();

  // Captured at init (getContext constraint); also fires when nested inside a
  // hydrating island, not just when the directive sits on the component itself.
  const hydratable = isHydratable();

  const locals = getRequestContext().locals;
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
      // A `<` could break out of the raw <style> tag; refuse it.
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

  // The unnamed remainder lives in `root`; stop it cross-fading so only the regions animate.
  const rootReset = $derived(regions == null ? '' : `\n    ::view-transition-old(root), ::view-transition-new(root) { animation: none; }`);

  const reducedTargets = $derived([...new Set([...targets, 'root'])].map((name) => `::view-transition-old(${name}), ::view-transition-new(${name})`).join(', '));

  // Name each kept selector from the selector itself (not its index) so names
  // stay stable across reordering; a per-slug counter disambiguates collisions.
  const keepRules = $derived.by(() => {
    const selectors = keepElementSelectors == null ? [] : Array.isArray(keepElementSelectors) ? keepElementSelectors : [keepElementSelectors];
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local scratch state rebuilt on every evaluation of this derived; nothing reactive escapes it
    const seen = new Map<string, number>();
    return selectors
      .map((selector) => {
        // A `<` could break out of the raw <style> tag; refuse it.
        if (selector.includes('<')) {
          throw new Error(`<ViewTransitions /> keepElementSelectors must not contain "<", got ${JSON.stringify(selector)}.`);
        }
        // Collapse non-alphanumeric runs to spaces so slugify treats CSS symbols
        // as separators instead of transliterating them (`>` → `greater`).
        // `|| 'el'` covers selectors with no alphanumerics (e.g. `*`).
        const slug = slugify(selector.replace(/[^a-z0-9]+/gi, ' '), { lower: true, strict: true }) || 'el';
        const n = seen.get(slug) ?? 0;
        seen.set(slug, n + 1);
        const name = `mochi-vt-keep-${slug}${n ? `-${n}` : ''}`;
        // Freeze group (no slide/resize) + old/new (no cross-fade).
        return `${selector} { view-transition-name: ${name}; }
    ::view-transition-group(${name}),
    ::view-transition-old(${name}),
    ::view-transition-new(${name}) { animation: none; }`;
      })
      .join('\n    ');
  });

  // Build the <style> tag as a string rather than in markup: that keeps the
  // literal `</style>` out of the template, which svelte2tsx mis-parses.
  const styleTag = $derived.by(() => {
    if (hydratable) {
      throw new Error('<ViewTransitions /> must not be hydrated — it emits static CSS only. Remove the mochi: directives.');
    }
    if (!Number.isFinite(duration) || duration < 0) {
      throw new Error(`<ViewTransitions /> duration must be a non-negative number of milliseconds, got ${JSON.stringify(duration)}.`);
    }
    // A `<` could break out of the raw <style> tag; refuse it.
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
