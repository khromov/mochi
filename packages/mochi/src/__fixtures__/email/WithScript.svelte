<script lang="ts">
  let { name }: { name: string } = $props();
  const tag = 'scr' + 'ipt';
  const injected = `<${tag}>window.tracked = true;</${tag}>`;
</script>

<div class="card">
  <h1>Hello {name}</h1>
  {@html injected}
</div>

<style>
  .card {
    padding: 24px;
  }
</style>
