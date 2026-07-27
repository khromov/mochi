<script lang="ts">
  import Icon from '../components/Icon.svelte';
  let props = $props();
  const iconNode = [
    ['rect', { width: '20', height: '16', x: '2', y: '4', rx: '2' }],
    ['path', { d: 'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7' }],
  ];
</script>

<Icon name="mail" {...props} {iconNode} />
