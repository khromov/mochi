<script lang="ts">
  const props = $props<{ initialLikes: number }>();
  let likes = $state(props.initialLikes);
</script>

<button onclick={() => likes++}>♥ {likes}</button>
