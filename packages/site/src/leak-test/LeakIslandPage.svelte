<script>
  import LeakIsland from './LeakIsland.svelte';

  // ~1 KB random hex string. Per-run randomness means the encrypted props blob
  // captured by the leak harness changes across runs, so any engine-level
  // memoization on a constant payload (string interning, signature cache hits)
  // can't accidentally mask a leak that would surface on real, varied traffic.
  const buf = new Uint8Array(512);
  crypto.getRandomValues(buf);
  const bigProp = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
</script>

<LeakIsland mochi:defer mochi:hydrate name="LeakTester" {bigProp}>
  <div>Loading…</div>
</LeakIsland>
