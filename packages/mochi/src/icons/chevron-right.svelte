<script lang="ts">
  import Icon from '../components/Icon.svelte';
  let props = $props();
  const iconNode = [['path', { d: 'm9 18 6-6-6-6' }]];
</script>

<Icon name="chevron-right" {...props} {iconNode} />
