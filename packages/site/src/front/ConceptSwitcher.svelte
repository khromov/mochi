<script lang="ts">
  import { concepts } from './concepts';

  let { current }: { current: number } = $props();
</script>

<nav class="switcher" aria-label="Front page concepts">
  <span class="label">Concepts</span>
  <a href="/" title="The current front page">Now</a>
  {#each concepts as concept (concept.n)}
    <a href="/front-{concept.n}/" title={concept.name} aria-current={concept.n === current ? 'page' : undefined}>{concept.n}</a>
  {/each}
</nav>

<style>
  .switcher {
    position: fixed;
    left: 12px;
    bottom: 12px;
    z-index: 9999;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    font-family: 'Public Sans', system-ui, sans-serif;
    font-size: 0.78rem;
    background: rgba(18, 20, 17, 0.86);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  }

  .label {
    padding: 0 0.5rem 0 0.4rem;
    color: rgba(255, 255, 255, 0.55);
    font-weight: 500;
  }

  a {
    min-width: 28px;
    padding: 0.3rem 0.55rem;
    text-align: center;
    color: rgba(255, 255, 255, 0.85);
    font-weight: 600;
    text-decoration: none;
    border-radius: 7px;
    transition: background 0.12s ease;
  }

  a:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  a[aria-current='page'] {
    background: #f4f1e8;
    color: #141712;
  }

  @media (max-width: 640px) {
    .switcher {
      bottom: 64px;
    }
  }
</style>
