<script lang="ts">
  // Takes no props and renders nothing: it exists only to register the sidechain
  // guest, which reports this document's height to the embedding page.
  //
  // Dynamic import, not a top-level one: `mochi:clientOnly` skips the render, but
  // the page's import of this module still runs during SSR — and sidechain does
  // `class Sidechain extends HTMLElement` at module scope, which throws there.
  $effect(() => {
    let guest: { unregister(): void } | undefined;
    let onTheme: ((event: MessageEvent) => void) | undefined;
    let cancelled = false;

    void import('@nprapps/sidechain').then(({ default: Sidechain }) => {
      if (cancelled) {
        return;
      }
      guest = Sidechain.registerGuest({ polling: 300 });
      // The initial theme arrives in the URL (applied pre-paint by the shell);
      // this only carries later toggles on the host page. `null` means the host
      // went back to auto, so the system preference takes over again.
      onTheme = Sidechain.matchMessage({ sentinel: 'mochi', type: 'theme' }, (data) => {
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
