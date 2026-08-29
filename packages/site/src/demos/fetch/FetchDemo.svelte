<script>
  import { mochiFetch as fetch } from 'mochi-framework';
  import { pokemonCache } from '../../lib/cache';
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);

  // mochiFetch is a drop-in for fetch: same call, plus retries, a timeout, and
  // a base URL. Here it loads a Pokémon from PokéAPI resiliently, wrapped in
  // MochiCache so the resilient fetch only fires on a cache miss rather than on
  // every render. The retries ride out a flaky upstream; if it's fully
  // unreachable, mochiFetch throws after the last attempt — and because the
  // factory throws, that transient failure is never cached as a success.
  async function loadPokemon() {
    try {
      const pokemon = await pokemonCache.fetch('mochi-fetch:pikachu', async () => {
        const res = await fetch('pokemon/pikachu', {
          baseUrl: 'https://pokeapi.co/api/v2/',
          retries: 3,
          timeout: 5_000,
        });
        if (!res.ok) {
          throw new Error(`PokéAPI responded ${res.status}`);
        }
        const data = await res.json();
        // A 200 with an unexpected shape (e.g. a maintenance payload) would let
        // the template deref `data.sprites`/`.types`/`.stats` and throw at the
        // page top level — outside this try/catch — turning a soft failure into
        // a 500. Validate up front so those cases degrade gracefully too.
        if (!data?.sprites || !Array.isArray(data.types) || !Array.isArray(data.stats)) {
          throw new Error('Unexpected response shape');
        }
        return data;
      });
      return { pokemon, loadError: '' };
    } catch (e) {
      return { pokemon: null, loadError: e instanceof Error ? e.message : String(e) };
    }
  }

  const { pokemon, loadError } = await loadPokemon();

  const types = pokemon?.types.map((t) => t.type.name) ?? [];
  const stats = pokemon?.stats.map((s) => ({ name: s.stat.name, value: s.base_stat })) ?? [];
  const maxStat = 255;
</script>

<DemoPage
  title="Resilient Fetch"
  description="mochiFetch() is a drop-in for fetch that adds retries with backoff, a per-attempt timeout, and an optional base URL — otherwise a standard Response. Aliased to fetch, it loads a Pokémon from PokéAPI at request time."
  {sources}
>
  {#if pokemon}
    <div class="card">
      <img class="sprite" src={pokemon.sprites.front_default} alt={pokemon.name} width="96" height="96" />
      <div class="head">
        <span class="name">{pokemon.name}</span>
        <span class="id">#{String(pokemon.id).padStart(3, '0')}</span>
      </div>
      <div class="types">
        {#each types as t (t)}
          <span class="type">{t}</span>
        {/each}
      </div>
      <div class="stats">
        {#each stats as s (s.name)}
          <div class="row">
            <span class="stat-name">{s.name}</span>
            <span class="num">{s.value}</span>
            <div class="bar-track">
              <div class="bar" style="width:{Math.round((s.value / maxStat) * 100)}%"></div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {:else}
    <p class="not-found">Could not load the Pokémon{loadError ? ` (${loadError})` : ''}.</p>
  {/if}
</DemoPage>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    width: 100%;
    max-width: 320px;
    margin: 0 auto;
    padding: 1.5rem;
    text-align: center;
  }

  .sprite {
    image-rendering: pixelated;
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .name {
    font-size: 1.25rem;
    font-weight: 600;
    text-transform: capitalize;
    color: var(--text);
  }

  .id {
    font-family: var(--font-mono);
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .types {
    display: flex;
    justify-content: center;
    gap: 0.4rem;
    margin-bottom: 1.25rem;
  }

  .type {
    font-size: 0.75rem;
    text-transform: capitalize;
    padding: 0.15rem 0.6rem;
    border-radius: 999px;
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--text-muted);
  }

  .stats {
    text-align: left;
  }

  .row {
    display: grid;
    grid-template-columns: 80px 36px 1fr;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.45rem;
  }

  .stat-name {
    font-size: 0.8rem;
    color: var(--text-muted);
    text-transform: capitalize;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .num {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text);
    font-family: var(--font-mono);
    text-align: right;
  }

  .bar-track {
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: 999px;
    height: 6px;
    overflow: hidden;
  }

  .bar {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--accent-soft), var(--accent));
    min-width: 4px;
  }

  .not-found {
    text-align: center;
    color: var(--text-muted);
    padding: 2rem 0;
  }
</style>
