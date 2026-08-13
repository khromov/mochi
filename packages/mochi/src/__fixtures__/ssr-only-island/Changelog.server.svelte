<script lang="ts">
  import { readFileSync } from 'node:fs';

  const entries = readFileSync('package.json', 'utf8').length;
</script>

<pre>changelog-bytes-{entries}</pre>
