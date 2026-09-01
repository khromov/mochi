<script lang="ts">
  import { isBrowser } from 'mochi-framework';
  import Badge from '../../components/Badge.svelte';
  import { typeOf } from './devalueTypeOf.ts';
  import type { MochiDirectives } from 'mochi-framework';

  let {
    dateVal,
    regexpVal,
    mapVal,
    setVal,
    bigintVal,
    urlVal,
    searchParamsVal,
    typedArrayVal,
    undefinedVal,
    infinityVal,
    nanVal,
    negZeroVal,
    repeatedRef,
    cyclicRef,
    serverTypes,
  }: {
    dateVal: Date;
    regexpVal: RegExp;
    mapVal: Map<string, number>;
    setVal: Set<number>;
    bigintVal: bigint;
    urlVal: URL;
    searchParamsVal: URLSearchParams;
    typedArrayVal: Uint8Array;
    undefinedVal: undefined;
    infinityVal: number;
    nanVal: number;
    negZeroVal: number;
    repeatedRef: { x: number }[];
    cyclicRef: { name: string; self?: unknown };
    serverTypes: Record<string, string>;
  } & MochiDirectives = $props();

  function display(v: unknown): string {
    if (v === undefined) {
      return 'undefined';
    }
    if (v === null) {
      return 'null';
    }
    if (typeof v === 'number') {
      if (Number.isNaN(v)) {
        return 'NaN';
      }
      if (v === Infinity) {
        return 'Infinity';
      }
      if (Object.is(v, -0)) {
        return '-0';
      }
    }
    if (typeof v === 'bigint') {
      return `${v}n`;
    }
    if (v instanceof Date) {
      return v.toISOString();
    }
    if (v instanceof RegExp) {
      return String(v);
    }
    if (v instanceof Map) {
      return `Map(${v.size}) { ${[...v.entries()].map(([k, val]) => `${k} => ${val}`).join(', ')} }`;
    }
    if (v instanceof Set) {
      return `Set(${v.size}) { ${[...v].join(', ')} }`;
    }
    if (v instanceof URL) {
      return v.href;
    }
    if (v instanceof URLSearchParams) {
      return v.toString();
    }
    if (v instanceof Uint8Array) {
      return `Uint8Array [${[...v].join(', ')}]`;
    }
    if (Array.isArray(v)) {
      return JSON.stringify(v);
    }
    if (typeof v === 'object' && v !== null) {
      if ((v as { self?: unknown }).self === v) {
        return '{ self: [Circular] }';
      }
      return JSON.stringify(v);
    }
    return String(v);
  }

  // svelte-ignore state_referenced_locally
  const rows = [
    { label: 'Date', value: dateVal },
    { label: 'RegExp', value: regexpVal },
    { label: 'Map', value: mapVal },
    { label: 'Set', value: setVal },
    { label: 'BigInt', value: bigintVal },
    { label: 'URL', value: urlVal },
    { label: 'URLSearchParams', value: searchParamsVal },
    { label: 'Uint8Array', value: typedArrayVal },
    { label: 'undefined', value: undefinedVal },
    { label: 'Infinity', value: infinityVal },
    { label: 'NaN', value: nanVal },
    { label: '-0', value: negZeroVal },
    { label: 'Repeated ref', value: repeatedRef },
    { label: 'Cyclic ref', value: cyclicRef },
  ];
</script>

<div class="target" class:hydrated={isBrowser}>
  <div class="header">
    <span class="title">ClientRenderedChild.svelte</span>
    <Badge kind={isBrowser ? 'success' : 'info'}>
      {isBrowser ? 'Client (hydrated)' : 'Server (SSR)'}
    </Badge>
  </div>

  <table>
    <thead>
      <tr>
        <th>Prop</th>
        <th>Value</th>
        <th>Server type</th>
        <th>Client type</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.label)}
        <tr>
          <td class="label"><code>{row.label}</code></td>
          <td class="value"><code>{display(row.value)}</code></td>
          <td class="type"><code>{serverTypes[row.label] ?? '—'}</code></td>
          <td class="type"><code>{isBrowser ? typeOf(row.value) : '—'}</code></td>
        </tr>
      {/each}
      <tr>
        <td class="label"><code>Repeated ref</code></td>
        <td class="value"><code>{repeatedRef[0] === repeatedRef[1] ? 'same ref' : 'different refs'}</code></td>
        <td class="type"><code>identity check</code></td>
        <td class="type"><code>{isBrowser ? 'identity check' : '—'}</code></td>
      </tr>
      <tr>
        <td class="label"><code>Cyclic ref</code></td>
        <td class="value"><code>{cyclicRef.self === cyclicRef ? 'self === obj' : 'broken'}</code></td>
        <td class="type"><code>identity check</code></td>
        <td class="type"><code>{isBrowser ? 'identity check' : '—'}</code></td>
      </tr>
    </tbody>
  </table>
</div>

<style>
  .target {
    padding: 1rem 1.25rem;
    border: 2px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    overflow-x: auto;
    transition:
      border-color 0.12s ease,
      background 0.12s ease;
  }

  .target.hydrated {
    border-color: var(--badge-success-text);
    background: var(--badge-success-bg);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .title {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: 1rem;
    color: var(--text);
  }

  table {
    width: 100%;
    min-width: 640px;
    border-collapse: collapse;
    font-size: 0.9rem;
  }

  th {
    text-align: left;
    padding: 0.4rem 0.55rem;
    border-bottom: 2px solid var(--border-strong);
    color: var(--text-muted);
    font-weight: 600;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  td {
    padding: 0.4rem 0.55rem;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }

  tbody tr:last-child td {
    border-bottom: 0;
  }

  .label code {
    font-weight: 600;
    color: var(--text);
  }

  .value code,
  .type code {
    background: var(--surface);
    border: 1px solid var(--border);
    padding: 0.12rem 0.4rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.85rem;
    color: var(--text);
    word-break: break-all;
  }

  .type code {
    color: var(--text-muted);
  }
</style>
