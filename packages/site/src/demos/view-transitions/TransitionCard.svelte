<script lang="ts">
  import PersistentVideo from './PersistentVideo.svelte';
  import ViewTransitionFirefoxNote from '../../components/ViewTransitionFirefoxNote.svelte';
  import { TRANSITIONS, type TransitionType } from './shared';

  let { page, type }: { page: 1 | 2; type: TransitionType } = $props();

  const self = $derived(page === 1 ? '/demos/view-transitions' : '/demos/view-transitions/two');
  const other = $derived(page === 1 ? '/demos/view-transitions/two' : '/demos/view-transitions');
  const query = $derived(type === 'fade' ? '' : `?type=${type}`);
</script>

<div class="card" class:two={page === 2}>
  <span class="num">Page {page}</span>
  <p>Each navigation is a full page load — the browser animates it with a <code>{type}</code> transition.</p>
  <a class="next" href={`${other}${query}`}>Go to page {page === 1 ? 2 : 1} →</a>
</div>

<ViewTransitionFirefoxNote />

<div class="picker">
  <span>Transition:</span>
  {#each TRANSITIONS as opt (opt)}
    <a class="opt" class:active={type === opt} href={opt === 'fade' ? self : `${self}?type=${opt}`}>{opt}</a>
  {/each}
</div>

<PersistentVideo />

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    padding: 2.5rem;
    border-radius: 12px;
    background: var(--code-bg);
    color: var(--code-text);
    border: 1px solid var(--border);
    /* The page passes regions="card" to <ViewTransitions>, confining the
       animation to this element while the rest of the page swaps instantly. */
    view-transition-name: card;
  }

  .card.two {
    background: var(--code-accent);
    color: #fff;
    border-color: transparent;
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
