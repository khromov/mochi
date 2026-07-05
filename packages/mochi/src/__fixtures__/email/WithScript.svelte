<script lang="ts">
  let { name }: { name: string } = $props();
  const tag = 'scr' + 'ipt';
  const injected = `<${tag}>window.tracked = true;</${tag}>`;
</script>

<div class="card">
  <h1>Hello {name}</h1>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- fixture: a hardcoded local string built to test that renderEmailComponent strips <script>, not end-user input -->
  {@html injected}
</div>

<style>
  .card {
    padding: 24px;
  }
</style>
