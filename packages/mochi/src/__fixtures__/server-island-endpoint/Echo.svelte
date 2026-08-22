<script lang="ts">
  const uid = $props.id();
  const props: Record<string, unknown> = $props();
</script>

<div class="echo" data-uid={uid} data-prop-keys={Object.keys(props).sort().join(',')}>{String(props.name ?? '')}</div>
