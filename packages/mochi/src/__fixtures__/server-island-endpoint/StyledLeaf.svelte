<script lang="ts">
  const uid = $props.id();
</script>

<div class="styled-leaf" data-uid={uid}>leaf</div>

<style>
  .styled-leaf {
    color: teal;
  }
</style>
