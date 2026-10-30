<script lang="ts">
  import { bump, label } from './shared';

  let n = $state(0);
</script>

<button onclick={() => (n = bump(2))}>B: {label(n)}</button>
