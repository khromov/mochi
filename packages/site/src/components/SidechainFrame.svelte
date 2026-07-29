<script lang="ts">
  import type { ClientOnlyProps } from 'mochi-framework';
  import type { Sidechain } from '@nprapps/sidechain';

  let { src, title }: ClientOnlyProps<{ src: string; title: string }> = $props();

  let host = $state<Sidechain | null>(null);

  /** `null` means auto — the guest is left to follow the visitor's system preference. */
  function currentTheme(): 'light' | 'dark' | null {
    const value = document.documentElement.getAttribute('data-theme');
    return value === 'light' || value === 'dark' ? value : null;
  }

  // The guest is cross-origin, so it can't read this site's theme choice out of
  // localStorage. Baking it into the URL is what lets the guest apply it before
  // its first paint; the postMessage below only covers later toggles.
  const initialSrc = (() => {
    const theme = currentTheme();
    if (!theme) {
      return src;
    }
    const url = new URL(src, location.href);
    url.searchParams.set('theme', theme);
    return url.toString();
  })();

  // Dynamic import, not a top-level one: `mochi:clientOnly` skips the render, but
  // the page's import of this module still executes during SSR — and sidechain
  // does `class Sidechain extends HTMLElement` at module scope, which throws there.
  $effect(() => {
    void import('@nprapps/sidechain').then(async () => {
      await customElements.whenDefined('side-chain');
      // <side-chain> only forwards src/id/allow to its inner iframe, so the
      // accessible name has to be set on the iframe itself.
      if (host?.iframe) {
        host.iframe.title = title;
      }
    });
  });

  // Watching the attribute rather than hooking ThemeToggle keeps the two
  // independent: anything that changes the theme is picked up here.
  $effect(() => {
    const observer = new MutationObserver(() => {
      // Optional call: the element only gains its methods once the dynamic import
      // above has upgraded it.
      host?.sendMessage?.({ sentinel: 'mochi', type: 'theme', theme: currentTheme() });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  });
</script>

<side-chain bind:this={host} src={initialSrc}></side-chain>
