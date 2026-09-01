<script lang="ts">
  import type { ClientOnlyProps, MochiDirectives } from 'mochi-framework';

  // The same origins the CSP lets frame us — `matchMessage` filters on payload
  // shape only, so without this any window holding a handle to this frame could
  // drive its theme.
  let { origins }: ClientOnlyProps<{ origins: string[] }> & MochiDirectives = $props();

  // Dynamic import: `mochi:clientOnly` skips the render, but the page's import of
  // this module still runs during SSR, where sidechain's module-scope
  // `extends HTMLElement` throws.
  $effect(() => {
    let guest: { unregister(): void } | undefined;
    let onTheme: ((event: MessageEvent) => void) | undefined;
    let cancelled = false;

    void import('@nprapps/sidechain').then(({ default: Sidechain }) => {
      if (cancelled) {
        return;
      }
      guest = Sidechain.registerGuest({ polling: 300 });
      const allowed = new Set([location.origin, ...origins]);
      // The initial theme arrives in the URL; this carries later host toggles.
      onTheme = Sidechain.matchMessage({ sentinel: 'mochi', type: 'theme' }, (data, event) => {
        if (!allowed.has(event.origin)) {
          return;
        }
        const theme = data.theme;
        if (theme === 'light' || theme === 'dark') {
          document.documentElement.setAttribute('data-theme', theme);
        } else {
          document.documentElement.removeAttribute('data-theme');
        }
      });
      window.addEventListener('message', onTheme);
    });

    return () => {
      cancelled = true;
      guest?.unregister();
      if (onTheme) {
        window.removeEventListener('message', onTheme);
      }
    };
  });
</script>
