<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import CodeSnippet from '../../components/CodeSnippet.svelte';
  import ClientRenderedChild from './ClientRenderedChild.svelte';
  import { typeOf } from './devalueTypeOf.ts';
  import { loadSources } from '../../components/utils.ts';
  import { highlightCode } from '../../lib/highlight.server';
  import { files } from './files.ts';

  const sources = await loadSources(files);

  const codeProps = await highlightCode(
    `const dateVal = new Date('2025-01-15T12:00:00Z');
const mapVal = new Map([['a', 1], ['b', 2], ['c', 3]]);
const setVal = new Set([10, 20, 30]);
const bigintVal = 9007199254740993n;
const urlVal = new URL('https://mochi.dev/docs?version=5');
// ...
const cyclic: { name: string; self?: unknown } = { name: 'cyclic' };
cyclic.self = cyclic;
const cyclicRef = cyclic;`,
    'ts',
  );

  const shared = { x: 1 };
  const cyclic: { name: string; self?: unknown } = { name: 'cyclic' };
  cyclic.self = cyclic;

  const dateVal = new Date('2025-01-15T12:00:00Z');
  const regexpVal = /hello\s+world/gi;
  const mapVal = new Map<string, number>([
    ['a', 1],
    ['b', 2],
    ['c', 3],
  ]);
  const setVal = new Set([10, 20, 30]);
  const bigintVal = 9007199254740993n;
  const urlVal = new URL('https://mochi.dev/docs?version=5');
  const searchParamsVal = new URLSearchParams('theme=dark&lang=en');
  const typedArrayVal = new Uint8Array([72, 101, 108, 108, 111]);
  const undefinedVal = undefined;
  const infinityVal = Infinity;
  const nanVal = NaN;
  const negZeroVal = -0;
  const repeatedRef = [shared, shared];
  const cyclicRef = cyclic;

  const serverTypes: Record<string, string> = {
    Date: typeOf(dateVal),
    RegExp: typeOf(regexpVal),
    Map: typeOf(mapVal),
    Set: typeOf(setVal),
    BigInt: typeOf(bigintVal),
    URL: typeOf(urlVal),
    URLSearchParams: typeOf(searchParamsVal),
    Uint8Array: typeOf(typedArrayVal),
    undefined: typeOf(undefinedVal),
    Infinity: typeOf(infinityVal),
    NaN: typeOf(nanVal),
    '-0': typeOf(negZeroVal),
    'Repeated ref': typeOf(repeatedRef),
    'Cyclic ref': typeOf(cyclicRef),
  };
</script>

<DemoPage
  title="Crossing the server-client boundary with props"
  description="Props you pass from a server-rendered parent to a hydrated child island are automatically serialized via devalue, preserving Date, RegExp, Map, Set, BigInt, URL, typed arrays, undefined, Infinity, NaN, -0, and even repeated and cyclic references — all reconstructed identically on the client."
  {sources}
>
  <section class="parent">
    <header>
      <h2>ServerRenderedParent.svelte</h2>
      <p>
        Runs only on the server. No <code>mochi:hydrate</code> directive, so this component ships zero JavaScript — its output is inert HTML. It builds a props bag covering every
        type devalue supports and hands it off to the child below. The <code>Server type</code> column in the child is captured here, before serialization; the
        <code>Client type</code> column is resolved after hydration. Matching values prove the round-trip preserved each type.
      </p>
    </header>
    <CodeSnippet html={codeProps} />
  </section>

  <div class="arrow" aria-hidden="true">
    <span>props</span>
    <span class="line"></span>
    <span class="head">▼</span>
  </div>

  <ClientRenderedChild
    {dateVal}
    {regexpVal}
    {mapVal}
    {setVal}
    {bigintVal}
    {urlVal}
    {searchParamsVal}
    {typedArrayVal}
    {undefinedVal}
    {infinityVal}
    {nanVal}
    {negZeroVal}
    {repeatedRef}
    {cyclicRef}
    {serverTypes}
    mochi:hydrate
  />
</DemoPage>

<style>
  .parent {
    border: 2px dashed var(--border);
    border-radius: var(--radius-md);
    padding: 1rem 1.25rem;
    background: var(--surface);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .parent header {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .parent h2 {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
  }

  .parent p {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.95rem;
    line-height: 1.5;
  }

  .parent code {
    font-family: var(--font-mono);
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.1em 0.35em;
    border-radius: 4px;
    font-size: 0.85em;
  }

  .arrow {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    color: var(--text-subtle);
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0.4rem 0;
  }

  .arrow .line {
    width: 2px;
    height: 1.25rem;
    background: var(--border-strong);
  }

  .arrow .head {
    color: var(--border-strong);
    line-height: 1;
  }
</style>
