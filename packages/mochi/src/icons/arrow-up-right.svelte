<script lang="ts">
  import Icon from './Icon.svelte';
  let props = $props();
  const iconNode = [
    ['path', { d: 'M7 7h10v10' }],
    ['path', { d: 'M7 17 17 7' }],
  ];
</script>

<Icon name="arrow-up-right" {...props} {iconNode} />
