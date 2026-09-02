<script lang="ts">
  type Item = { id: number; text: string };
  type Theme = { bg: string; fg: string; accent: string };

  let {
    label,
    theme,
    items,
  }: {
    label: string;
    theme: Theme;
    items: Item[];
  } = $props();
</script>

<article class="card" style="--bg: {theme.bg}; --fg: {theme.fg}; --accent: {theme.accent};">
  <span class="label">{label}</span>
  <ul>
    {#each items as item (item.id)}
      <li>{item.text}</li>
    {/each}
  </ul>
</article>

<style>
  .card {
    padding: 0.85rem 1rem;
    border: 2px solid var(--accent);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--fg);
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  .label {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: 0.95rem;
  }

  ul {
    margin: 0;
    padding-left: 1.1rem;
    font-size: 0.88rem;
    line-height: 1.5;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
</style>
