<script>
  import LeakIsland from './LeakIsland.svelte';

  // ~1 KB random hex string; per-run randomness stops engine-level memoization on a constant
  // payload from masking a leak that would only surface on real, varied traffic.
  const buf = new Uint8Array(512);
  crypto.getRandomValues(buf);
  const bigProp = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
</script>

<LeakIsland mochi:defer mochi:hydrate name="LeakTester" {bigProp}>
  <div>Loading…</div>
</LeakIsland>
