<script>
  import { params } from 'mochi-framework';
  import { pokemonCache } from '../../lib/cache';
  import DemoPage from '../../components/DemoPage.svelte';
  import PokemonHeader from './PokemonHeader.svelte';
  import PokemonMeta from './PokemonMeta.svelte';
  import PokemonStats from './PokemonStats.svelte';
  import PokemonSelector from './PokemonSelector.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);

  const id = (params.id ?? 'pikachu').toLowerCase();

  const [pokemon, options] = await Promise.all([
    pokemonCache.fetch(`pokemon:${id}`, async () => {
      const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(id)}`);
      return res.ok ? await res.json() : null;
    }),
    pokemonCache.fetch('pokemon:list:151', async () => {
      const res = await fetch('https://pokeapi.co/api/v2/pokemon?limit=151');
      const data = await res.json();
      return data.results;
    }),
  ]);

  const types = pokemon?.types.map((t) => t.type.name) ?? [];
  const abilities = pokemon?.abilities.map((a) => a.ability.name) ?? [];
  const stats = pokemon?.stats.map((s) => ({ name: s.stat.name, value: s.base_stat })) ?? [];
</script>

<DemoPage
  title="Data Loading"
  description="You can fetch server-side data inside any non-hydrated Svelte component by loading it at the top level — no special API needed. Wrap the fetch in MochiCache for fast, cached access across requests."
  {sources}
>
  <PokemonSelector mochi:hydrate current={id} {options} />

  {#if pokemon}
    <div class="card">
      <PokemonHeader id={pokemon.id} name={pokemon.name} sprite={pokemon.sprites.front_default} />
      <div class="divider"></div>
      <PokemonMeta {types} height={pokemon.height} weight={pokemon.weight} baseXp={pokemon.base_experience} {abilities} />
      <div class="divider"></div>
      <PokemonStats mochi:hydrate {stats} />
    </div>
  {:else}
    <p class="not-found">No Pokémon found for "{id}".</p>
  {/if}
</DemoPage>

<style>
  .card {
    background: var(--surface);
    border-radius: var(--radius-lg);
    width: 100%;
    max-width: 320px;
    margin: 0 auto;
    overflow: hidden;
    border: 1px solid var(--border);
  }

  .divider {
    height: 1px;
    background: var(--border);
    margin: 0 1.5rem;
  }

  .not-found {
    text-align: center;
    color: var(--text-muted);
    padding: 2rem 0;
  }
</style>
