<script lang="ts">
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import { branches, kitCell, kitNote, mochiNote } from '../lib/batteries';

  const nodes = branches.flatMap((branch) => branch.nodes);
  const kitCount = (status: string) => nodes.filter((node) => kitCell(node).status === status).length;
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
      <span class="root-kit">SvelteKit</span>
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
                    <span class="card-label">
                      {node.label}
                      {#if kit.status === 'partial'}<span class="tilde" aria-hidden="true">~</span>{/if}
                    </span>
                    <span class="notes">
                      <span class="note note-mochi">{mochiNote(node)}</span>
                      <span class="note note-kit">
                        {#if kit.status === 'partial'}<span class="sr-only">Partial:</span>{/if}
                        {kitNote(node)}
                      </span>
                    </span>
                  </span>
                </a>
              </li>
            {/each}
          </ul>
        </li>
      {/each}
    </ul>
  </div>

  <p class="tally" aria-live="polite">
    <span class="tally-mochi">All {nodes.length} built in, no extra packages.</span>
    <span class="tally-kit">SvelteKit: {kitCount('yes')} built in · {kitCount('partial')} partial · {kitCount('no')} bring your own.</span>
    <a class="tally-link" href="/docs/mochi-vs-sveltekit/">Full comparison <ArrowRight size={14} strokeWidth={2} /></a>
  </p>
</div>

<style>
  .batteries {
    --line: var(--border-strong);
    --kit-orange: #ff3e00;
    display: grid;
    justify-items: center;
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
    align-items: flex-start;
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
    gap: 0.1rem;
    min-width: 0;
  }

  .card-label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-weight: 600;
    font-size: 0.95rem;
    line-height: 1.3;
  }

  .notes {
    display: grid;
  }

  .note {
    grid-area: 1 / 1;
    font-family: var(--font-mono);
    font-size: 0.74rem;
    line-height: 1.45;
    color: var(--text-subtle);
  }

  .note-kit {
    visibility: hidden;
    font-family: var(--font-sans);
    font-size: 0.8rem;
  }

  .tilde {
    display: none;
    align-items: center;
    justify-content: center;
    width: 1.1rem;
    height: 1.1rem;
    border-radius: 50%;
    background: #e07b2c;
    color: #fff;
    font-weight: 700;
    font-size: 1.05rem;
    line-height: 1;
  }

  .tally {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 0.4rem 1rem;
    margin-top: 2rem;
    text-align: center;
    font-size: 0.95rem;
    color: var(--text-muted);
  }

  .tally-kit {
    display: none;
  }

  .tally-link {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-weight: 600;
    color: var(--accent);
    text-decoration: none;
  }

  .tally-link:hover {
    color: var(--accent-hover);
  }

  .tally-link:focus-visible {
    outline: none;
    border-radius: var(--radius-sm);
    box-shadow: var(--focus-ring);
  }

  .batteries:has(input[value='kit']:checked) .root {
    background: var(--kit-orange);
    color: #fff;
  }

  .batteries:has(input[value='kit']:checked) .root-mochi,
  .batteries:has(input[value='kit']:checked) .tally-mochi {
    display: none;
  }

  .batteries:has(input[value='kit']:checked) .root-kit,
  .batteries:has(input[value='kit']:checked) .tally-kit {
    display: inline;
  }

  .batteries:has(input[value='kit']:checked) .note-mochi {
    visibility: hidden;
  }

  .batteries:has(input[value='kit']:checked) .note-kit {
    visibility: visible;
  }

  .batteries:has(input[value='kit']:checked) .leaf[data-kit='partial'] .tilde {
    display: inline-flex;
  }

  .batteries:has(input[value='kit']:checked) .leaf[data-kit='partial'] .card,
  .batteries:has(input[value='kit']:checked) .leaf[data-kit='no'] .card {
    border-style: dashed;
    background: transparent;
    box-shadow: none;
  }

  .batteries:has(input[value='kit']:checked) .leaf[data-kit='partial'] .card {
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
        opacity 0.2s ease,
        background 0.2s ease,
        border-color 0.15s ease,
        box-shadow 0.15s ease;
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
