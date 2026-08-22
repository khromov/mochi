<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
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

  // Island `component-name`s are `<localName>_<base36 hash of resolved path>` (see `islandIdentity` in
  // svelteAstPreprocess.ts). The framework appends exactly one such segment, so dropping the trailing run of
  // lowercase/digits recovers the author's name for a friendly label even when that name contains underscores.
  function displayNameOf(componentName: string): string {
    return componentName.replace(/_[0-9a-z]+$/, '') || componentName;
  }

  function scanIslands() {
    const result: IslandInfo[] = [];
    const hydratable = document.querySelectorAll('mochi-hydratable-island');
    const server = document.querySelectorAll('mochi-server-island');

    hydratable.forEach((element) => {
      const name = element.getAttribute('component-name') ?? 'unknown';
      // The server-island fetch wraps its content in a `<mochi-hydratable-island>` under the same component-name, which
      // the server-island entry already represents, so that realized child is skipped. Matching on `also-hydrate` plus
      // the name keeps a genuinely separate `mochi:hydrate` child nested in a plain `mochi:defer` island listed.
      const host = element.closest('mochi-server-island');
      if (host?.getAttribute('also-hydrate') && host.getAttribute('component-name') === name) {
        return;
      }
      const mode = element.getAttribute('hydrate-on') === 'visible' ? 'mochi:hydrate:visible' : 'mochi:hydrate';
      // Props ride in a `<script type="application/json">` block emitted just before the island, carrying `data-shared`
      // only when two or more islands reuse the payload. The also-hydrate path inlines `props=...`, hence the fallback.
      const propsRef = element.getAttribute('props-ref');
      let rawProps: string | null;
      let shared = false;
      if (propsRef) {
        const block = document.getElementById(propsRef);
        rawProps = block?.textContent ?? null;
        shared = block?.hasAttribute('data-shared') ?? false;
      } else {
        rawProps = element.getAttribute('props');
      }
      const propsSize = rawProps?.length ?? 0;
      result.push({
        element: element as HTMLElement,
        name,
        displayName: displayNameOf(name),
        type: 'hydrated',
        mode,
        propsSize,
        rawProps,
        signedProps: null,
        propsRef,
        shared,
        serverOptions: null,
      });
    });

    server.forEach((element) => {
      const name = element.getAttribute('component-name') ?? 'unknown';
      const mode = describeServerIslandMode(element.getAttribute('defer-on'), element.getAttribute('also-hydrate'));
      const signedProps = element.getAttribute('signed-props');
      const propsSize = signedProps?.length ?? 0;
      result.push({
        element: element as HTMLElement,
        name,
        displayName: displayNameOf(name),
        type: 'server',
        mode,
        propsSize,
        rawProps: null,
        signedProps,
        propsRef: null,
        shared: false,
        serverOptions: element.getAttribute('server-options'),
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

<DebugPanel title="Islands" color="#8ab79a" {open} {onclose}>
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
        {#each hydratedIslands as island (island.element)}
          <IslandRow {island} />
        {/each}
      {/if}

      {#if serverIslands.length > 0}
        <div class="island-group-label">Server Islands</div>
        {#each serverIslands as island (island.element)}
          <IslandRow {island} />
        {/each}
      {/if}
    {/if}
  </div>
</DebugPanel>

<style>
  .island-summary {
    background: #272a22;
    color: #bdc2b4;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid #353930;
    font-size: 11px;
    line-height: 1.6;
    margin-bottom: 6px;
  }
  .island-summary :global(strong) {
    color: #e8e6dd;
    font-weight: 700;
  }
  .island-group-label {
    color: #8c9286;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 8px 6px 4px;
    font-family: inherit;
  }
  .island-empty {
    color: #72786c;
    font-size: 11px;
    padding: 16px 10px;
    text-align: center;
    font-style: italic;
  }
  .props-warn {
    display: inline-block;
    font-size: 9px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 3px;
    vertical-align: 1px;
    margin-left: 2px;
    cursor: help;
  }
  .props-warn-yellow {
    background: #2f281a;
    color: #d5b982;
  }
  .props-warn-red {
    background: #351f1a;
    color: #e9a89a;
  }
</style>
