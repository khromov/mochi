<script lang="ts">
  type Feature = { name: string; blurb: string; file: string; html: string };

  let { features }: { features: Feature[] } = $props();

  const uid = $props.id();
  let selected = $state(0);

  const current = $derived(features[selected]);

  const STEP: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

  function onkeydown(event: KeyboardEvent) {
    let next: number;
    const step = STEP[event.key];
    if (step !== undefined) {
      next = (selected + step + features.length) % features.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = features.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    selected = next;
    document.getElementById(`${uid}-tab-${next}`)?.focus();
  }
</script>

<div class="explorer">
  <div class="list" role="tablist" aria-label="Mochi features" aria-orientation="vertical">
    {#each features as feature, i (feature.name)}
      <button
        type="button"
        role="tab"
        id="{uid}-tab-{i}"
        aria-controls="{uid}-panel"
        aria-selected={selected === i}
        tabindex={selected === i ? 0 : -1}
        class="tab"
        class:active={selected === i}
        onclick={() => (selected = i)}
        {onkeydown}
      >
        <span class="tab-name">{feature.name}</span>
        <span class="tab-blurb">{feature.blurb}</span>
      </button>
    {/each}
  </div>

  {#if current}
    <div class="panel" role="tabpanel" id="{uid}-panel" aria-labelledby="{uid}-tab-{selected}">
      <p class="panel-blurb">{current.blurb}</p>
      <div class="panel-bar">
        <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="file">{current.file}</span>
      </div>
      <div class="panel-code">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html current.html}
      </div>
    </div>
  {/if}
</div>

<style>
  .explorer {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.4fr);
    gap: 1.5rem;
    align-items: start;
  }

  .list {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border, #222a21);
  }

  .tab {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.85rem 1rem 0.85rem 1.1rem;
    text-align: left;
    font: inherit;
    color: var(--text-muted, #a8ada0);
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--border, #222a21);
    cursor: pointer;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }

  .tab::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0.7rem;
    bottom: 0.7rem;
    width: 2px;
    background: var(--accent, #a7c9a8);
    transform: scaleY(0);
    transition: transform 0.2s ease;
  }

  .tab:hover {
    color: var(--text, #e8e6dd);
    background: rgba(232, 230, 221, 0.025);
  }

  .tab.active {
    color: var(--text, #e8e6dd);
    background: rgba(167, 201, 168, 0.06);
  }

  .tab.active::before {
    transform: scaleY(1);
  }

  .tab:focus-visible {
    outline: none;
    box-shadow: inset var(--focus-ring);
  }

  .tab-name {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.92rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .tab-blurb {
    display: none;
    font-size: 0.86rem;
    line-height: 1.45;
    color: var(--text-muted, #a8ada0);
  }

  .tab.active .tab-blurb {
    display: block;
  }

  .panel {
    position: sticky;
    top: 1.5rem;
    background: #0e120e;
    border: 1px solid var(--border-strong, #34402f);
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 30px 80px -30px rgba(0, 0, 0, 0.7);
  }

  .panel-blurb {
    display: none;
    padding: 0.85rem 1rem;
    font-size: 0.88rem;
    line-height: 1.45;
    color: var(--text-muted, #a8ada0);
    border-bottom: 1px solid var(--border, #222a21);
  }

  .panel-bar {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--border, #222a21);
    background: #121712;
  }

  .dots {
    display: inline-flex;
    gap: 6px;
  }

  .dots i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #2c352b;
  }

  .file {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.78rem;
    color: var(--text-subtle, #7d8577);
  }

  .panel-code {
    min-height: 16rem;
  }

  .panel-code :global(pre) {
    margin: 0;
    padding: 1.1rem 1.25rem;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.84rem;
    line-height: 1.65;
    background: transparent;
    border-radius: 0;
  }

  @media (max-width: 860px) {
    .explorer {
      grid-template-columns: minmax(0, 1fr);
      gap: 1rem;
    }

    .list {
      flex-direction: row;
      gap: 0.4rem;
      overflow-x: auto;
      padding-bottom: 0.35rem;
      border-top: 0;
      scrollbar-width: thin;
    }

    .tab {
      flex: 0 0 auto;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--border, #222a21);
      border-radius: 6px;
    }

    .tab::before {
      display: none;
    }

    .tab.active {
      border-color: var(--accent, #a7c9a8);
    }

    .tab.active .tab-blurb {
      display: none;
    }

    .tab-name {
      font-size: 0.82rem;
      white-space: nowrap;
    }

    .panel {
      position: static;
    }

    .panel-blurb {
      display: block;
    }
  }
</style>
