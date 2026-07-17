<script>
  // Deliberately mode-ambiguous: a bare reactive `let` with no runes and no
  // legacy-only syntax. The seed pass must decline, and using this file as a
  // hydrating island root must produce a compile-time warning.
  let count = 0;
</script>

<button on:click={() => count++}>{count}</button>
