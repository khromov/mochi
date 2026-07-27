<!--
  Adapted from @lucide/svelte v1.16.0 — ISC.
  See ./LICENSE-lucide.txt
-->
<script lang="ts">
  type IconNode = [string, Record<string, string | number>][];

  let {
    name,
    iconNode,
    size = 24,
    class: className,
    ...props
  }: {
    name: string;
    iconNode: IconNode;
    size?: number | string;
    class?: string;
    [key: string]: unknown;
  } = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  width={size}
  height={size}
  {...props}
  class={['lucide-icon', `lucide-${name}`, className]}
>
  {#each iconNode as [tag, attrs], i (i)}
    <svelte:element this={tag} {...attrs} />
  {/each}
</svg>
