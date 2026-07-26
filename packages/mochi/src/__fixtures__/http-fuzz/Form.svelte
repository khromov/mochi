<script lang="ts">
  let { form }: { form?: { message?: string } } = $props();
</script>

<form method="POST">
  <input name="q" />
  <button>go</button>
</form>

{#if form?.message}<p class="result">{form.message}</p>{/if}
