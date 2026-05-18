<script lang="ts">
  import Icon from './Icon.svelte';
  let props = $props();
  const iconNode = [['path', { d: 'm9 18 6-6-6-6' }]];
</script>

<Icon name="chevron-right" {...props} {iconNode} />
