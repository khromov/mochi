<script>
  import Outer from '$lib/Outer.svelte';
</script>

<!-- SvelteKit server-renders this page by default, which server-renders <Outer /> → crash. -->
<h1>SvelteKit SSR repro</h1>
<Outer />
