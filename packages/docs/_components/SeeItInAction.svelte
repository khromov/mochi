<script lang="ts">
  interface DemoLink {
    href: string;
    title: string;
    hook: string;
  }
  let { demos = [] }: { demos: DemoLink[] } = $props();
</script>

{#if demos.length > 0}
  <section class="see-it-in-action">
    <p class="sia-label">See it in action</p>
    <div class="sia-grid">
      {#each demos as demo (demo.href)}
        {@const external = demo.href.startsWith('http')}
        <a
          class="sia-card"
          href={demo.href}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
        >
          <span class="sia-title">{demo.title}</span>
          <span class="sia-hook">{demo.hook}</span>
        </a>
      {/each}
    </div>
  </section>
{/if}

<style>
  /* Adapted from DemoPage.svelte .more-* (icon styles dropped). */
  .see-it-in-action {
    margin: 2rem 0 0;
  }
  .sia-label {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-subtle);
    margin-bottom: 0.75rem;
  }
  .sia-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.75rem;
  }
  .sia-card {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.85rem 0.9rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    text-decoration: none;
    transition:
      box-shadow 0.15s ease,
      transform 0.15s ease;
  }
  .sia-card:hover {
    transform: translateY(-2px);
    box-shadow:
      inset 3px 0 0 var(--accent),
      var(--shadow-md);
  }
  .sia-title {
    font-family: var(--font-serif);
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text);
    letter-spacing: -0.005em;
    line-height: 1.3;
  }
  .sia-card:hover .sia-title {
    color: var(--accent);
  }
  .sia-hook {
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.45;
  }
</style>
