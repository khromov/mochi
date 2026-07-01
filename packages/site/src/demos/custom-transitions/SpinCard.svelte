<script lang="ts">
  import ViewTransitionFirefoxNote from '../../components/ViewTransitionFirefoxNote.svelte';

  let { page }: { page: 1 | 2 } = $props();

  const other = $derived(page === 1 ? '/demos/custom-transitions/two' : '/demos/custom-transitions');
</script>

<div class="card" class:two={page === 2}>
  <span class="num">Page {page}</span>
  <p>Each navigation is a full page load — the card does a custom <code>spin</code> while the rest of the page swaps instantly.</p>
  <a class="next" href={other}>Go to page {page === 1 ? 2 : 1} →</a>
</div>

<ViewTransitionFirefoxNote />

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
</style>
