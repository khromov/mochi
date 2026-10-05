<script lang="ts">
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import { branches, kitCell, kitNote } from '../lib/batteries';
  import SvelteKitLogo from './SvelteKitLogo.svelte';
</script>

<div class="batteries">
  <fieldset class="compare">
    <legend class="sr-only">Compare with</legend>
    <label class="compare-option"><input type="radio" name="batteries-compare" value="mochi" checked />Mochi</label>
    <label class="compare-option"><input type="radio" name="batteries-compare" value="kit" />SvelteKit</label>
  </fieldset>

  <div class="tree">
    <div class="root">
      <span class="root-mochi"><span aria-hidden="true">🍡</span> mochi</span>
      <span class="root-kit"><SvelteKitLogo /></span>
    </div>

    <ul class="branches">
      {#each branches as branch (branch.title)}
        <li class="branch">
          <h3 class="branch-title">{branch.title}</h3>
          <ul class="leaves">
            {#each branch.nodes as node (node.label)}
              {@const kit = kitCell(node)}
              <li class="leaf" data-kit={kit.status}>
                <a class="card" href={node.href}>
                  <span class="card-icon"><node.icon size={18} strokeWidth={1.8} /></span>
                  <span class="card-text">
                    <span class="card-label">{node.label}</span>
                    {#if kit.status === 'partial'}
                      <span class="note-wrap"><span class="note"><span class="sr-only">Partial:</span> {kitNote(node)}</span></span>
                    {:else}
                      <span class="note sr-only">{kit.status === 'yes' ? 'Built in' : 'Not built in'}</span>
                    {/if}
                  </span>
                </a>
              </li>
            {/each}
          </ul>
        </li>
      {/each}
    </ul>
  </div>

  <a class="comparison-btn" href="/docs/mochi-vs-sveltekit/">
    Full comparison
    <ArrowRight size={16} strokeWidth={1.9} />
  </a>
</div>

<style>
  .batteries {
    --line: var(--border-strong);
    --partial-bg: #f7ecc4;
    --partial-fg: #9a7100;
    display: grid;
    justify-items: center;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .batteries {
      --partial-bg: #3a3318;
      --partial-fg: #e2bd52;
    }
  }

  :global(:root[data-theme='dark']) .batteries {
    --partial-bg: #3a3318;
    --partial-fg: #e2bd52;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .compare {
    display: inline-flex;
    gap: 2px;
    margin: 0 0 1.75rem;
    padding: 3px;
    min-inline-size: 0;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
  }

  .compare-option {
    position: relative;
    padding: 0.4rem 1.1rem;
    border-radius: 999px;
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--text-muted);
    cursor: pointer;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }

  .compare-option input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  .compare-option:hover {
    color: var(--text);
  }

  .compare-option:has(input:checked) {
    background: var(--accent);
    color: var(--accent-text);
  }

  .compare-option:has(input:focus-visible) {
    box-shadow: var(--focus-ring);
  }

  .tree {
    width: 100%;
    display: grid;
    justify-items: center;
  }

  .root {
    position: relative;
    padding: 0.55rem 1.4rem;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-text);
    font-family: var(--font-serif);
    font-size: 1.3rem;
    font-weight: 500;
    line-height: 1.5;
    letter-spacing: -0.01em;
    box-shadow: var(--shadow-md);
  }

  .root::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    height: 1.5rem;
    border-left: 2px solid var(--line);
  }

  .root-kit {
    display: none;
  }

  .branches {
    list-style: none;
    padding: 0;
    margin: 1.5rem 0 0;
    width: 100%;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1.25rem;
  }

  .branch {
    position: relative;
    padding-top: 1.5rem;
  }

  .branch::before {
    content: '';
    position: absolute;
    top: 0;
    left: -0.625rem;
    right: -0.625rem;
    border-top: 2px solid var(--line);
  }

  .branch:first-child::before {
    left: 50%;
  }

  .branch:last-child::before {
    right: 50%;
  }

  .branch::after {
    content: '';
    position: absolute;
    top: 0;
    left: 50%;
    height: 1.5rem;
    border-left: 2px solid var(--line);
  }

  .branch-title {
    padding: 0.5rem 0.9rem;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    font-family: var(--font-serif);
    font-size: 1.15rem;
    font-weight: 450;
    line-height: 1.25;
    letter-spacing: -0.01em;
    text-align: center;
    font-variation-settings:
      'opsz' 144,
      'SOFT' 50;
  }

  .leaves {
    list-style: none;
    padding: 0 0 0 1.9rem;
    margin: 0.7rem 0 0;
    display: grid;
    gap: 0.7rem;
  }

  .leaf {
    position: relative;
  }

  .leaf::before {
    content: '';
    position: absolute;
    left: -1rem;
    top: -0.7rem;
    width: 1rem;
    height: calc(50% + 0.7rem);
    border-left: 2px solid var(--line);
    border-bottom: 2px solid var(--line);
    border-bottom-left-radius: 8px;
  }

  .leaf:not(:last-child)::after {
    content: '';
    position: absolute;
    left: -1rem;
    top: 50%;
    bottom: 0;
    border-left: 2px solid var(--line);
  }

  .card {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.7rem 0.8rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: inherit;
    text-decoration: none;
  }

  .card:hover {
    border-color: var(--accent);
    box-shadow: var(--shadow-md);
  }

  .card:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: var(--focus-ring);
  }

  .card-icon {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    color: var(--accent-soft-text);
  }

  .card-text {
    display: grid;
    align-content: center;
    gap: 0.1rem;
    min-width: 0;
    min-height: 2.5rem;
  }

  .card-label {
    font-weight: 600;
    font-size: 0.95rem;
    line-height: 1.3;
  }

  .note {
    display: none;
    font-size: 0.8rem;
    line-height: 1.45;
    color: var(--text-subtle);
  }

  .note-wrap {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    visibility: hidden;
  }

  .note-wrap .note {
    display: block;
    min-height: 0;
    overflow: hidden;
  }

  .batteries:has(input[value='kit']:checked) .note-wrap {
    grid-template-rows: 1fr;
    opacity: 1;
    visibility: visible;
  }

  .comparison-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 2rem;
    padding: 0.75rem 1.2rem;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font-size: 0.98rem;
    font-weight: 600;
    text-decoration: none;
    transition:
      border-color 0.15s ease,
      color 0.15s ease;
  }

  .comparison-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .comparison-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .batteries:has(input[value='kit']:checked) .root {
    background: var(--surface);
    color: var(--text);
    box-shadow:
      var(--shadow-md),
      inset 0 0 0 1px var(--border-strong);
  }

  .batteries:has(input[value='kit']:checked) .root-mochi {
    display: none;
  }

  .batteries:has(input[value='kit']:checked) .root-kit {
    display: flex;
    align-items: center;
    height: 1.5em;
  }

  .root-kit :global(.sveltekit-logo) {
    height: 1.15em;
  }

  .batteries:has(input[value='kit']:checked) .note {
    display: block;
  }

  .batteries:has(input[value='kit']:checked) .leaf[data-kit='partial'] .card,
  .batteries:has(input[value='kit']:checked) .leaf[data-kit='no'] .card {
    border-style: dashed;
    background: transparent;
    box-shadow: none;
  }

  .batteries:has(input[value='kit']:checked) .leaf[data-kit='partial'] .card-icon {
    background: var(--partial-bg);
    color: var(--partial-fg);
    opacity: 0.75;
  }

  .batteries:has(input[value='kit']:checked) .leaf[data-kit='no'] .card {
    opacity: 0.4;
  }

  .batteries:has(input[value='kit']:checked) .leaf[data-kit='no'] .card-icon {
    background: var(--surface-muted);
    color: var(--text-subtle);
  }

  @media (prefers-reduced-motion: no-preference) {
    .card,
    .root {
      transition:
        opacity 0.35s ease,
        background 0.35s ease,
        border-color 0.35s ease,
        box-shadow 0.15s ease;
    }

    .note-wrap {
      transition:
        grid-template-rows 0.35s ease,
        opacity 0.35s ease,
        visibility 0.35s;
    }

    .card-icon {
      transition:
        background 0.35s ease,
        color 0.35s ease;
    }
  }

  @media (max-width: 1024px) {
    .root::after,
    .branch::before,
    .branch::after {
      display: none;
    }

    .branches {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 2rem 1.25rem;
    }

    .branch {
      padding-top: 0;
    }
  }

  @media (max-width: 600px) {
    .branches {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
