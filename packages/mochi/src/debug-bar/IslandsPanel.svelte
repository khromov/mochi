<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { logger } from 'mochi-framework';
  import type { IslandInfo } from './types';
  import { formatSize, getPropsWarnLevel, PROPS_WARN_RED_BYTES, PROPS_WARN_YELLOW_BYTES } from './utils';
  import IslandRow from './IslandRow.svelte';
  import DebugPanel from './DebugPanel.svelte';
  import { debugBarState } from './state.svelte';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let islands: IslandInfo[] = $state([]);

  // Total wire cost: count each unique shared-props payload once. An island
  // whose `propsRef` has already been tallied by an earlier island contributes 0.
  let totalProps = $derived.by(() => {
    const seenRefs = new SvelteSet<string>();
    let total = 0;
    for (const i of islands) {
      if (i.propsRef) {
        if (seenRefs.has(i.propsRef)) {
          continue;
        }
        seenRefs.add(i.propsRef);
      }
      total += i.propsSize;
    }
    return total;
  });
  let warnLevel = $derived(getPropsWarnLevel(totalProps));
  let hydratedIslands = $derived(islands.filter((i) => i.type === 'hydrated'));
  let serverIslands = $derived(islands.filter((i) => i.type === 'server'));

  $effect(() => {
    debugBarState.islandCount = islands.length;
    debugBarState.totalPropsSize = totalProps;
  });

  const propsWarnTip = 'This has a negative impact on page load speed. Reduce the amount of props you send or avoid hydrating this island.';

  const HYDRATE_SUFFIX: Record<string, string> = {
    visible: ' + mochi:hydrate:visible',
    eager: ' + mochi:hydrate',
  };

  function describeServerIslandMode(deferOn: string | null, alsoHydrate: string | null): string {
    const base = deferOn === 'visible' ? 'mochi:defer:visible' : 'mochi:defer';
    return base + (HYDRATE_SUFFIX[alsoHydrate ?? ''] ?? '');
  }

  function scanIslands() {
    const result: IslandInfo[] = [];
    const hydratable = document.querySelectorAll('mochi-hydratable-island');
    const server = document.querySelectorAll('mochi-server-island');

    hydratable.forEach((el) => {
      const id = el.getAttribute('island-id');
      if (!id) {
        logger.warn('[debug] Hydratable island missing island-id:', el);
        return;
      }
      const name = el.getAttribute('component-name') ?? 'unknown';
      const mode = el.getAttribute('hydrate-on') === 'visible' ? 'mochi:hydrate:visible' : 'mochi:hydrate';
      // Props may be inline (`props=...`) or hoisted into a shared
      // <script type="application/json" id="<propsRef>"> block when multiple
      // islands on the page share the exact same payload.
      const propsRef = el.getAttribute('props-ref');
      let rawProps: string | null;
      if (propsRef) {
        rawProps = document.getElementById(propsRef)?.textContent ?? null;
      } else {
        rawProps = el.getAttribute('props');
      }
      const propsSize = rawProps?.length ?? 0;
      result.push({
        id,
        name,
        type: 'hydrated',
        mode,
        propsSize,
        rawProps,
        propsRef,
        serverOptions: null,
      });
    });

    server.forEach((el) => {
      const id = el.getAttribute('island-id');
      if (!id) {
        logger.warn('[debug] Server island missing island-id:', el);
        return;
      }
      const name = el.getAttribute('component-name') ?? 'unknown';
      const mode = describeServerIslandMode(el.getAttribute('defer-on'), el.getAttribute('also-hydrate'));
      const propsSize = el.getAttribute('signed-props')?.length ?? 0;
      result.push({
        id,
        name,
        type: 'server',
        mode,
        propsSize,
        rawProps: null,
        propsRef: null,
        serverOptions: el.getAttribute('server-options'),
      });
    });

    islands = result;
  }

  onMount(() => {
    scanIslands();

    let scanTimer: ReturnType<typeof setTimeout>;
    const observer = new MutationObserver(() => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => scanIslands(), 500);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      clearTimeout(scanTimer);
    };
  });
</script>

<DebugPanel title="Islands" color="#22d3ee" {open} {onclose}>
  <div class="island-body">
    {#if islands.length === 0}
      <div class="island-empty">No islands found on this page.</div>
    {:else}
      <div class="island-summary">
        <strong>{islands.length}</strong> island{islands.length !== 1 ? 's' : ''}
        &middot; <strong>{formatSize(totalProps)}</strong> total props
        {#if warnLevel === 'red'}
          <span class="props-warn props-warn-red" title="Props exceed {formatSize(PROPS_WARN_RED_BYTES)}. {propsWarnTip}">!</span>
        {:else if warnLevel === 'yellow'}
          <span class="props-warn props-warn-yellow" title="Props exceed {formatSize(PROPS_WARN_YELLOW_BYTES)}. {propsWarnTip}">!</span>
        {/if}
        {#if hydratedIslands.length}
          &middot; {hydratedIslands.length} hydrated
        {/if}
        {#if serverIslands.length}
          &middot; {serverIslands.length} server
        {/if}
      </div>

      {#if hydratedIslands.length > 0}
        <div class="island-group-label">Hydrated Islands</div>
        {#each hydratedIslands as island (island.id)}
          <IslandRow {island} />
        {/each}
      {/if}

      {#if serverIslands.length > 0}
        <div class="island-group-label">Server Islands</div>
        {#each serverIslands as island (island.id)}
          <IslandRow {island} />
        {/each}
      {/if}
    {/if}
  </div>
</DebugPanel>

<style>
  .island-summary {
    background: #2a2a3e;
    color: #94a3b8;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 11px;
    line-height: 1.6;
    margin-bottom: 6px;
  }
  .island-summary :global(strong) {
    color: #e2e8f0;
  }
  .island-group-label {
    color: #64748b;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 6px 6px 4px;
  }
  .island-empty {
    color: #64748b;
    font-size: 11px;
    padding: 12px 10px;
    text-align: center;
  }
  .props-warn {
    display: inline-block;
    font-size: 9px;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 3px;
    vertical-align: 1px;
    margin-left: 2px;
    cursor: help;
  }
  .props-warn-yellow {
    background: #78350f;
    color: #fbbf24;
  }
  .props-warn-red {
    background: #7f1d1d;
    color: #fca5a5;
  }
</style>
