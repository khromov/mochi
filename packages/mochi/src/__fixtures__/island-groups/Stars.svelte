<script lang="ts">
  import type { Snippet } from 'svelte';

  // `children` is the mochi:defer fallback, never rendered by this component — typed so grouped call sites accept it.
  let { repo }: { repo: string; children?: Snippet } = $props();
  const uid = $props.id();
</script>

<span class="stars" data-uid={uid}>{repo}:{repo.length}</span>

<style>
  .stars {
    color: goldenrod;
  }
</style>
