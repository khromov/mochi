<script lang="ts">
  import Widget from './Widget.svelte';
  import WidgetLazy from './WidgetLazy.svelte';
</script>

<main>
  <Widget mochi:clientOnly label="hi"><p data-fallback>loading</p></Widget>
  <WidgetLazy mochi:clientOnly:visible={{ rootMargin: '150px' }} label="lazy"><p data-fallback-visible>loading lazily</p></WidgetLazy>
</main>
