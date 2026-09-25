<script lang="ts">
  import BrowserFrame from './BrowserFrame.svelte';
  import SvelteLogo from './SvelteLogo.svelte';

  let hydrated = $state(false);
</script>

<div class="hydrate-demo" class:hydrated>
  <div class="cta">
    <div class="cta-anchor">
      <button type="button" class="hydrate-btn" aria-pressed={hydrated} onclick={() => (hydrated = !hydrated)}>
        <span class="btn-chip" aria-hidden="true">🍡</span>
        <span class="btn-labels">
          <span class="btn-label label-click" class:shown={!hydrated}>Click to hydrate</span>
          <span class="btn-label label-tap" class:shown={!hydrated}>Tap to hydrate</span>
          <span class="btn-label" class:shown={hydrated}>Reset demo</span>
        </span>
      </button>
      <svg class="arrow" viewBox="0 0 200 72" aria-hidden="true">
        <path d="M4 28C48 10 116 2 154 18c18 8 27 24 29 42" />
        <path d="M175.1 51c3 2.9 5.7 5.8 7.9 9 1.5-3.4 3.3-6.9 5.8-10.5" />
      </svg>
    </div>
  </div>

  <BrowserFrame>
    <div class="page">
      <div class="row">
        <div class="box header"><SvelteLogo /> header <span class="js">0 kB JS</span></div>
        <div class="box island badge"><SvelteLogo /> user profile</div>
      </div>
      <div class="row body">
        <div class="box island sidebar"><SvelteLogo /> sidebar</div>
        <div class="box main"><SvelteLogo /> main <span class="js">0 kB JS</span></div>
      </div>
      <div class="box footer"><SvelteLogo /> footer <span class="js">0 kB JS</span></div>
    </div>

    <ul class="legend">
      <li class="legend-ssr"><SvelteLogo size={15} /> SSR</li>
      <li><SvelteLogo size={15} /> Island</li>
    </ul>
  </BrowserFrame>
</div>

<style>
  .hydrate-demo {
    --btn-pad-y: 0.6rem;
    --btn-chip: 1.85rem;
    --line: var(--border-strong);
    --soft: var(--surface-muted);
    --logo-gray: #b9bdb4;
    --island: #ff3e00;
    --island-hover: #e63700;
    --island-soft: #fff0ea;
    --island-text: #b32e00;
    --svelte-logo-inner: var(--surface);
    font-family: var(--font-sans);
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .hydrate-demo {
      --logo-gray: #50554a;
      --island-soft: #34201a;
      --island-text: #ffb59c;
    }
  }

  :global(:root[data-theme='dark']) .hydrate-demo {
    --logo-gray: #50554a;
    --island-soft: #34201a;
    --island-text: #ffb59c;
  }

  .cta {
    position: relative;
    display: flex;
    justify-content: center;
    margin-bottom: 1.75rem;
  }

  .cta-anchor {
    position: relative;
  }

  .arrow {
    --arrow-width: 7.5rem;
    position: absolute;
    top: calc(var(--btn-pad-y) + var(--btn-chip) / 2 + 1px - 0.14 * var(--arrow-width));
    left: calc(100% + 0.4rem);
    width: var(--arrow-width);
    height: auto;
    fill: none;
    stroke: var(--text-muted);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .hydrate-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    padding: var(--btn-pad-y) 1.2rem var(--btn-pad-y) var(--btn-pad-y);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 0.98rem;
    font-weight: 600;
    cursor: pointer;
    user-select: none;
    transition:
      border-color 0.15s ease,
      color 0.15s ease;
  }

  .hydrate-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .hydrate-btn:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: var(--focus-ring);
  }

  .btn-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--btn-chip);
    height: var(--btn-chip);
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    font-size: 1rem;
    line-height: 1;
  }

  .btn-labels {
    display: grid;
  }

  .btn-label {
    grid-area: 1 / 1;
    white-space: nowrap;
    visibility: hidden;
  }

  .btn-label.shown {
    visibility: visible;
  }

  .label-tap {
    display: none;
  }

  @media (hover: none) and (pointer: coarse) {
    .label-click {
      display: none;
    }

    .label-tap {
      display: inline;
    }
  }

  .legend {
    list-style: none;
    padding: 0;
    margin: 0.85rem 0 0;
    display: flex;
    justify-content: flex-end;
    gap: 1.1rem;
    font-size: 0.82rem;
    color: var(--text-subtle);
  }

  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .legend-ssr :global(.svelte-logo) {
    color: var(--logo-gray);
  }

  .page {
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: 0.5rem;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .row {
    display: flex;
    gap: 0.5rem;
  }

  .body {
    min-height: 8.5rem;
  }

  .box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    min-height: 3.1rem;
    padding: 0.5rem;
    border: 1.5px dashed var(--line);
    border-radius: var(--radius-sm);
    background: var(--soft);
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: 0.74rem;
    line-height: 1.2;
    letter-spacing: 0.03em;
    text-align: center;
    transition:
      border-color 200ms ease,
      background-color 200ms ease,
      color 200ms ease;
  }

  .box :global(.svelte-logo) {
    color: var(--logo-gray);
  }

  .js {
    font-size: 0.66rem;
    letter-spacing: 0.02em;
    opacity: 0.75;
  }

  .header,
  .main {
    flex: 1;
  }

  .badge {
    flex-shrink: 0;
    width: 5.5rem;
  }

  .sidebar {
    flex-shrink: 0;
    width: 30%;
  }

  .hydrated .island {
    border-style: solid;
    border-color: var(--island);
    background: var(--island-soft);
    color: var(--island-text);
  }

  .hydrated .island :global(.svelte-logo) {
    color: var(--island);
  }

  @media (max-width: 600px) {
    .cta {
      margin-bottom: 1rem;
    }

    .arrow {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .box,
    .hydrate-btn {
      transition: none;
    }
  }
</style>
