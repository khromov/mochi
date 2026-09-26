<script lang="ts">
  import LandingShell from './components/LandingShell.svelte';
  import MoreBento from './components/drafts/MoreBento.svelte';

  const variants = [
    {
      id: 'bento',
      name: 'Bento with figures',
      note: 'Mixed-size cells, each carrying a real artifact: a terminal, the debug bar, library logos, agent tooling. Inspired by Retool, Cursor and Miro.',
      component: MoreBento,
    },
  ];
</script>

<LandingShell
  metaTags={{
    title: 'Draft: section variants',
    robots: 'noindex, nofollow',
  }}
>
  <div class="wrap">
    <header class="page-head">
      <h1>Drafts</h1>
      <p>Draft treatment of the "From first commit to production" section. Not linked from anywhere.</p>
      <nav class="jump" aria-label="Variants">
        {#each variants as variant (variant.id)}
          <a href="#{variant.id}">{variant.name}</a>
        {/each}
      </nav>
    </header>

    {#each variants as variant, i (variant.id)}
      <section class="variant" id={variant.id} aria-labelledby="{variant.id}-title">
        <header class="variant-head">
          <span class="variant-index">Variant {i + 1}</span>
          <h2 id="{variant.id}-title">{variant.name}</h2>
          <p>{variant.note}</p>
        </header>

        <div class="stage">
          <div class="section-head">
            <h3>From first commit to production</h3>
            <p>The parts of a project that aren't the page.</p>
          </div>
          <variant.component />
        </div>
      </section>
    {/each}
  </div>
</LandingShell>

<style>
  .wrap {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 1.5rem 5rem;
  }

  h1,
  h2,
  h3 {
    font-family: var(--font-serif);
    font-weight: 450;
    color: var(--text);
    letter-spacing: -0.015em;
    font-variation-settings:
      'opsz' 144,
      'SOFT' 50;
  }

  .page-head {
    padding: 3.5rem 0 1rem;
  }

  .page-head h1 {
    font-size: clamp(2.4rem, 5vw, 3.4rem);
    line-height: 1.05;
    margin-bottom: 0.75rem;
  }

  .page-head p {
    max-width: 44rem;
    font-size: 1.12rem;
    line-height: 1.55;
    color: var(--text-muted);
  }

  .jump {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 1.5rem;
  }

  .jump a {
    padding: 0.3rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-muted);
    font-size: 0.875rem;
    font-weight: 500;
    text-decoration: none;
  }

  .jump a:hover {
    border-color: var(--accent);
    color: var(--text);
  }

  .variant {
    padding-top: 3.5rem;
    scroll-margin-top: 4.5rem;
  }

  .variant + .variant {
    margin-top: 1rem;
    border-top: 1px dashed var(--border-strong);
  }

  .variant-head {
    margin-bottom: 1.5rem;
    max-width: 44rem;
  }

  .variant-index {
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent);
  }

  .variant-head h2 {
    font-size: 1.6rem;
    line-height: 1.15;
    margin: 0.25rem 0 0.4rem;
  }

  .variant-head p {
    color: var(--text-muted);
    line-height: 1.55;
  }

  .stage {
    padding: 4rem clamp(1rem, 3vw, 2.5rem);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg);
  }

  .section-head {
    margin-bottom: 2.75rem;
    max-width: 44rem;
  }

  .section-head h3 {
    font-size: clamp(1.9rem, 3.4vw, 2.6rem);
    line-height: 1.1;
    margin-bottom: 0.75rem;
    text-wrap: balance;
  }

  .section-head p {
    font-size: 1.08rem;
    line-height: 1.55;
    color: var(--text-muted);
  }

  @media (max-width: 720px) {
    .wrap {
      padding: 0 1rem 3.5rem;
    }

    .stage {
      padding: 2.5rem 1rem;
    }
  }
</style>
