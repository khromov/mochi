<script lang="ts">
  let { title = 'home' } = $props();
</script>

<header class="site-header">
  <nav>
    <a href="/">Home</a>
    <a href="/about">About</a>
  </nav>
</header>
<main>
  <h1>{title}</h1>
  <p>Shared page chrome that a navigation dictionary should compress away.</p>
</main>

<style>
  .site-header {
    border-bottom: 1px solid #ccc;
  }
</style>
