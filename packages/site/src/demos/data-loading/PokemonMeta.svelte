<script>
  const { types, height, weight, baseXp, abilities } = $props();

  const typeColors = {
    normal: '#A8A878',
    fire: '#F08030',
    water: '#6890F0',
    electric: '#F8D030',
    grass: '#78C850',
    ice: '#98D8D8',
    fighting: '#C03028',
    poison: '#A040A0',
    ground: '#E0C068',
    flying: '#A890F0',
    psychic: '#F85888',
    bug: '#A8B820',
    rock: '#B8A038',
    ghost: '#705898',
    dragon: '#7038F8',
    dark: '#705848',
    steel: '#B8B8D0',
    fairy: '#EE99AC',
  };

  function textOn(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255,
      g = (n >> 8) & 255,
      b = n & 255;
    return (r * 299 + g * 587 + b * 114) / 1000 >= 140 ? '#1f2a24' : '#fff';
  }
</script>

<div class="meta">
  <div class="types">
    {#each types as t (t)}
      <span class="type-badge" style="background:{typeColors[t] ?? '#888'};color:{textOn(typeColors[t] ?? '#888')}">{t}</span>
    {/each}
  </div>

  <div class="stats-grid">
    <div class="stat-item">
      <span class="label">Height</span>
      <span class="value">{(height / 10).toFixed(1)} m</span>
    </div>
    <div class="stat-item">
      <span class="label">Weight</span>
      <span class="value">{(weight / 10).toFixed(1)} kg</span>
    </div>
    <div class="stat-item">
      <span class="label">Base XP</span>
      <span class="value">{baseXp}</span>
    </div>
    <div class="stat-item">
      <span class="label">Abilities</span>
      <span class="value abilities">{abilities.join(', ')}</span>
    </div>
  </div>
</div>

<style>
  .meta {
    padding: 1rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .types {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
  }

  .type-badge {
    padding: 0.25rem 0.9rem;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: capitalize;
    letter-spacing: 0.04em;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
  }

  .stat-item {
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 0.5rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
  }

  .value {
    font-size: 0.95rem;
    color: var(--text);
    font-weight: 500;
    text-transform: capitalize;
  }

  .abilities {
    font-size: 0.85rem;
  }
</style>
