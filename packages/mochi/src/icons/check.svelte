<script lang="ts">
  import Icon from '../components/Icon.svelte';
  let props = $props();
  const iconNode = [['path', { d: 'M20 6 9 17l-5-5' }]];
</script>

<Icon name="check" {...props} {iconNode} />
