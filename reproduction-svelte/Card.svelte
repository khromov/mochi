<script>
  import { hydratable } from 'svelte';

  // An async `$derived` puts this component on Svelte's async SSR path, so the
  // code after the await runs in a promise `.then()` continuation.
  const ready = $derived(await Promise.resolve(true));

  // `hydratable()` reads Svelte's INTERNAL render context, which Svelte tracks in
  // its own AsyncLocalStorage (svelte/src/internal/server/render-context.js:
  // `get_render_context()` -> `context ?? als.getStore()`). In the continuation
  // above, `context` has been reset to null, so it relies on `als.getStore()`.
  // Bun 1.4.0 drops that store, so `get_render_context()` throws
  // `server_context_required`. Nothing here is app- or framework-specific.
  const value = $derived.by(() => {
    void ready;
    return hydratable('card', () => 'server-value');
  });
</script>

<span>{value}</span>
