<script lang="ts">
  let { initialLikes }: { initialLikes: number } = $props();
  let likes = $state(initialLikes);
</script>

<button onclick={() => likes++}>♥ {likes}</button>
