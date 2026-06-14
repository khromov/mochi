<script lang="ts">
  import { SPINS, type Spin } from './shared';

  let { page, spin }: { page: 1 | 2; spin: Spin } = $props();

  const self = $derived(page === 1 ? '/demos/custom-transitions' : '/demos/custom-transitions/two');
  const other = $derived(page === 1 ? '/demos/custom-transitions/two' : '/demos/custom-transitions');
  const query = $derived(spin.key === SPINS[0].key ? '' : `?spin=${spin.key}`);
</script>

<div class="card" class:two={page === 2}>
  <span class="num">Page {page}</span>
  <p>Each navigation is a full page load — the card does a custom <code>{spin.label}</code> spin while the rest of the page swaps instantly.</p>
  <a class="next" href={`${other}${query}`}>Go to page {page === 1 ? 2 : 1} →</a>
</div>

<div class="picker">
  <span>Spin:</span>
  {#each SPINS as opt (opt.key)}
    <a class="opt" class:active={spin.key === opt.key} href={opt.key === SPINS[0].key ? self : `${self}?spin=${opt.key}`}>{opt.label}</a>
  {/each}
</div>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    padding: 2.5rem;
    border-radius: 16px;
    color: #fff;
    border: 1px solid transparent;
    background: linear-gradient(135deg, #7c3aed, #db2777);
    box-shadow: 0 12px 30px -12px rgba(124, 58, 237, 0.6);
    /* The page passes regions="card" to <ViewTransitions>, confining the spin
       to this element while the rest of the page swaps instantly. */
    view-transition-name: card;
  }

  .card.two {
    background: linear-gradient(135deg, #0891b2, #16a34a);
    box-shadow: 0 12px 30px -12px rgba(8, 145, 178, 0.6);
  }

  .num {
    font-size: 2rem;
    font-weight: 800;
  }

  .card p {
    margin: 0;
    font-size: 0.95rem;
  }

  code {
    font-family: var(--font-mono);
    font-size: 0.85em;
    background: rgba(255, 255, 255, 0.18);
    padding: 0.1em 0.4em;
    border-radius: 5px;
  }

  .next {
    align-self: flex-start;
    font-weight: 700;
    text-decoration: none;
    color: inherit;
    border-bottom: 2px solid currentColor;
  }

  .picker {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-top: 1.2rem;
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  .opt {
    padding: 0.2rem 0.6rem;
    border-radius: 6px;
    border: 1px solid var(--border);
    text-decoration: none;
    color: var(--text);
  }

  .opt.active {
    background: var(--text);
    color: var(--bg);
    border-color: var(--text);
  }
</style>
