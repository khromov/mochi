<script lang="ts">
  let { name }: { name: string } = $props();
</script>

<div class="card">
  <h1>Hello {name}</h1>
  <p class="muted">Welcome to Mochi.</p>
</div>

<style>
  .card {
    padding: 24px;
    background: #ffffff;
  }
  h1 {
    color: #6b46c1;
  }
  .muted {
    color: #888888;
  }
</style>
