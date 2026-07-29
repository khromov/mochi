<script lang="ts">
  import type { ClientOnlyProps } from 'mochi-framework';
  import type { Sidechain } from '@nprapps/sidechain';

  let { src, title }: ClientOnlyProps<{ src: string; title: string }> = $props();

  let host = $state<Sidechain | null>(null);

  // `null` means auto — the guest falls back to the system preference.
  function currentTheme(): 'light' | 'dark' | null {
    const value = document.documentElement.getAttribute('data-theme');
    return value === 'light' || value === 'dark' ? value : null;
  }

  // In the URL rather than a message, so the guest can apply it before first paint.
  const initialSrc = (() => {
    const theme = currentTheme();
    if (!theme) {
      return src;
    }
    const url = new URL(src, location.href);
    url.searchParams.set('theme', theme);
    return url.toString();
  })();

  // Dynamic import: `mochi:clientOnly` skips the render, but the page's import of
  // this module still runs during SSR, where sidechain's module-scope
  // `extends HTMLElement` throws.
  $effect(() => {
    void import('@nprapps/sidechain').then(async () => {
      await customElements.whenDefined('side-chain');
      // <side-chain> forwards only src/id/allow, so the name goes on the iframe.
      if (host?.iframe) {
        host.iframe.title = title;
      }
    });
  });

  $effect(() => {
    const observer = new MutationObserver(() => {
      // Optional call: the element gains its methods only once upgraded.
      host?.sendMessage?.({ sentinel: 'mochi', type: 'theme', theme: currentTheme() });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  });
</script>

<side-chain bind:this={host} src={initialSrc}></side-chain>
