<script lang="ts">
  import OptOutChild from './OptOutChild.svelte';
</script>

<p data-marker="optout-chain">optout top</p>
<OptOutChild mochi:defer={{ inline: false }}><span data-marker="optout-fallback">loading optout child</span></OptOutChild>
