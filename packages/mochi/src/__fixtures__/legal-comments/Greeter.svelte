<script lang="ts">
  import { greet } from './licensed';

  let name = $state('world');
</script>

<button onclick={() => (name = 'again')}>{greet(name)}</button>
