<script>
  import CtxProbe from './CtxProbe.svelte';

  // Deliberately mode-ambiguous: a bare reactive `let` with no runes and no
  // legacy-only syntax. The old script-grafting seed pass had to decline this
  // file; the boundary component seeds context from the render site, so using
  // it as a hydrating island root must now just work, with no warning.
  let count = 0;
</script>

<button on:click={() => count++}>{count}</button>
<CtxProbe />
