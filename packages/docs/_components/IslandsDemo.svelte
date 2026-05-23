<script lang="ts">
  let hydrated = $state(false);
</script>

<div class="islands-demo" class:hydrated>
  <div class="page">
    <div class="row row-header">
      <div class="box box-header">header</div>
      <div class="box box-island box-badge">user<br />profile</div>
    </div>

    <div class="row row-body">
      <div class="box box-island box-sidebar">sidebar</div>
      <div class="box box-main">main</div>
    </div>

    <div class="row row-footer">
      <div class="box box-footer">footer</div>
    </div>
  </div>

  <div class="controls">
    <button type="button" class="button" onclick={() => (hydrated = !hydrated)}>
      {#if hydrated}↺ Reset{:else}Hydrate islands →{/if}
    </button>
    <ul class="legend">
      <li><span class="swatch swatch-ssr"></span> ssr</li>
      <li><span class="swatch swatch-island"></span> island</li>
    </ul>
  </div>
</div>

<style>
  .islands-demo {
    margin: 1.5rem 0;
    font-family: var(--font-sans);
  }

  .page {
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 0.5rem;
    display: grid;
    gap: 0.5rem;
  }

  .row {
    display: flex;
    gap: 0.5rem;
  }

  .row-header .box-header {
    flex: 1;
  }
  .row-header .box-badge {
    width: 72px;
    height: 72px;
    min-height: 0;
    flex-shrink: 0;
    line-height: 1.15;
    text-align: center;
  }
  .row-body .box-sidebar {
    width: 140px;
    flex-shrink: 0;
  }
  .row-body .box-main {
    flex: 1;
  }
  .row-footer .box-footer {
    flex: 1;
  }

  .box {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 0.5rem;
    border: 1.5px dashed var(--demo-gray);
    border-radius: var(--radius-sm);
    background: var(--demo-gray-soft);
    color: var(--demo-gray-text);
    font-family: var(--font-mono);
    font-size: 0.78rem;
    text-transform: lowercase;
    letter-spacing: 0.04em;
    transition:
      border-color 150ms,
      background-color 150ms,
      color 150ms;
  }

  .box-sidebar {
    min-height: 110px;
  }

  /* After click: non-island boxes turn green (SSR'd, no JS). */
  .islands-demo.hydrated .box {
    border-style: solid;
    border-color: var(--demo-green);
    background: var(--demo-green-soft);
    color: var(--demo-green-text);
  }

  /* After click: island boxes turn orange (hydrated). Must come after the
     non-island rule above so its same-specificity selector wins by order. */
  .islands-demo.hydrated .box-island {
    border-color: var(--demo-accent);
    background: var(--demo-accent-soft);
    color: var(--demo-accent-text);
  }

  .controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.25rem;
    margin-top: 0.85rem;
    width: 100%;
    flex-wrap: wrap;
  }

  .button {
    display: inline-block;
    padding: 0.5rem 0.95rem;
    background: var(--demo-accent);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 500;
    user-select: none;
    transition: background-color 150ms;
  }
  .button:hover {
    background: var(--demo-accent-hover);
  }
  .button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgb(234 124 44 / 0.3);
  }

  .legend {
    list-style: none;
    padding: 0;
    margin: 0 0 0 auto;
    display: flex;
    gap: 1.25rem;
    font-size: 0.8rem;
    color: var(--text-subtle);
    flex-wrap: wrap;
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .swatch {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    display: inline-block;
  }
  .swatch-ssr {
    border: 1.5px solid var(--demo-green);
    background: var(--demo-green-soft);
  }
  .swatch-island {
    border: 1.5px solid var(--demo-accent);
    background: var(--demo-accent-soft);
  }

  /* Three-colour theme — scoped to this demo so it doesn't leak into doc
     styles. Gray = initial, green = SSR'd / non-hydrated, orange = hydrated. */
  .islands-demo {
    --demo-gray: #cbd0d3;
    --demo-gray-soft: #f3f4f5;
    --demo-gray-text: #6b7280;

    --demo-green: #5d9a73;
    --demo-green-soft: #dcefe3;
    --demo-green-text: #2e5b3f;

    --demo-accent: #ea7c2c;
    --demo-accent-hover: #d56a1f;
    --demo-accent-soft: #fbe9d6;
    --demo-accent-text: #8a4516;
  }

  :global(html.dark) .islands-demo,
  :global(html[data-theme='dark']) .islands-demo {
    --demo-gray: #3d4146;
    --demo-gray-soft: #22262a;
    --demo-gray-text: #9aa0a6;

    --demo-green: #7ab48e;
    --demo-green-soft: #1f2e25;
    --demo-green-text: #a4d2b3;

    --demo-accent: #f49654;
    --demo-accent-hover: #f7a872;
    --demo-accent-soft: #3a2615;
    --demo-accent-text: #f7c79b;
  }

  @media (prefers-reduced-motion: reduce) {
    .box,
    .button {
      transition: none;
    }
  }
</style>
