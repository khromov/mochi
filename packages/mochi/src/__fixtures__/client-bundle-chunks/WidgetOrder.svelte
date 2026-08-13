<script lang="ts">
  import { aFirst } from './aFirst';
  import { zSecond } from './zSecond';
  import { bOne } from './bOne';
  import { aTwo } from './aTwo';
  import { cThree } from './cThree';

  let n = $state(0);
</script>

<button onclick={() => n++}>{aFirst + zSecond + bOne + aTwo + cThree + n}</button>
