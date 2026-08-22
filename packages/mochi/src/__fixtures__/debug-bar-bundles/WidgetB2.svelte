<script lang="ts">
  import { heavyLabelOnlyOnB } from './heavyOnlyOnB';

  let count = $state(1);
</script>

<button onclick={() => count--}>{heavyLabelOnlyOnB(count)}</button>
