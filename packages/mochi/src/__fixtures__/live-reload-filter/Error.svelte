<script lang="ts">
  let { status, message }: { status: number; message: string } = $props();
</script>

<h1>Error {status}</h1>
<p>{message}</p>
