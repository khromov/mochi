<script lang="ts">
  import { getRequestContext } from 'mochi-framework';

  const user = getRequestContext().locals.user ?? 'anonymous';
</script>

<p>secret-data for {user}</p>
