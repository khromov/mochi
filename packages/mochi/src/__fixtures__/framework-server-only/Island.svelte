<script lang="ts">
  import { MochiCache } from 'mochi-framework';

  // Reference the import unconditionally so the client bundle retains it (and
  // thus the generated server-only stub). It renders fine on the server, where
  // MochiCache is the real class; the client never runs this in the test.
  const label = MochiCache.name;
</script>

<p data-testid="value">{label}</p>
