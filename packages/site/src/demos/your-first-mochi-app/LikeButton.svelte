<script lang="ts">
  const props: { initialLikes: number } = $props();
  let likes = $state(props.initialLikes);
</script>

<button onclick={() => likes++}>♥ {likes}</button>
