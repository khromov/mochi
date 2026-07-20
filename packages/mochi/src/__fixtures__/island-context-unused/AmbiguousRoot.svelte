<script>
  // Same deliberately mode-ambiguous shape as the island-context fixture, but
  // nothing in this build reads the hydration context — so the seed decline is
  // inert and must NOT warn. (Deliberately avoids naming the accessor: the
  // usage gate is a source-text scan and a mention here would defeat it.)
  let count = 0;
</script>

<button on:click={() => count++}>{count}</button>
