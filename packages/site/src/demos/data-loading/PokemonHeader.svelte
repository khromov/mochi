<script>
  import { isServer, isDev } from 'mochi-framework';

  const { id, name, sprite } = $props();
</script>

<svelte:head>
  <script type="module">
    console.log('Hello world! from the client!');
  </script>
</svelte:head>

<p class="env-badge">{isServer ? 'SERVER' : 'BROWSER'} | {isDev ? 'DEV' : 'PROD'}</p>

<div class="header">
  <img src={sprite} alt={name} class="sprite" />
  <div class="title">
    <span class="id">#{String(id).padStart(3, '0')}</span>
    <h1>{name}</h1>
  </div>
</div>

<style>
  .header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 1.5rem 1.5rem 0;
  }

  .sprite {
    width: 140px;
    height: 140px;
    image-rendering: pixelated;
    filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.15));
  }

  .title {
    text-align: center;
  }

  .id {
    font-size: 0.85rem;
    color: var(--text-muted);
    font-weight: 500;
    letter-spacing: 0.05em;
  }

  h1 {
    margin: 0.1rem 0 0;
    font-size: 1.8rem;
    font-weight: 700;
    color: var(--text);
    text-transform: capitalize;
    letter-spacing: 0.02em;
  }

  .env-badge {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.2rem 0.6rem;
    font-size: 0.75rem;
    color: var(--text-muted);
    display: table;
    margin: 0.5rem auto;
  }
</style>
