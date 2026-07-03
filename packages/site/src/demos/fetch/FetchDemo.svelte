<script>
  import { mochiFetch as fetch } from 'mochi-framework';
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);

  // mochiFetch is a drop-in for fetch: same call, plus retries, a timeout, and
  // a base URL. Here it loads a Pokémon from PokéAPI resiliently at request time.
  // The retries ride out a flaky upstream; if it's fully unreachable, mochiFetch
  // still throws after the last attempt — so degrade gracefully rather than 500.
  async function loadPokemon() {
    try {
      const res = await fetch('pokemon/pikachu', {
        baseUrl: 'https://pokeapi.co/api/v2/',
        retries: 3,
        timeout: 5_000,
      });
      if (res.ok) {
        return { pokemon: await res.json(), loadError: '' };
      }
      return { pokemon: null, loadError: `PokéAPI responded ${res.status}` };
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
