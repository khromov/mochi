<script lang="ts">
  const { initialLikes } = $props<{ initialLikes: number }>();
  let likes = $state(initialLikes);
</script>

<button onclick={() => likes++}>♥ {likes}</button>
