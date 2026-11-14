<script lang="ts">
  import LandingShell from './components/LandingShell.svelte';
  import DemoCard from './components/DemoCard.svelte';
  import { categoryLabels, categoryOrder, demos, type Demo } from './lib/demos';
  import { demoIconFor } from './lib/demoIcons';

  const withIcon = (list: Demo[]) =>
    list.flatMap((demo) => {
      const meta = demoIconFor[demo.title];
      return meta ? [{ ...demo, icon: meta.icon, label: meta.label }] : [];
    });

  const fullStack = withIcon(demos.filter((demo) => demo.category === 'sites'));

  const groups = categoryOrder
    .filter((category) => category !== 'sites')
    .map((category) => {
      const label = categoryLabels[category];
      return {
        id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        label,
        demos: withIcon(demos.filter((demo) => demo.category === category)),
      };
    })
    .filter((group) => group.demos.length > 0);
</script>

<LandingShell
  metaTags={{
    title: 'Demos',
    description: 'Every Mochi demo in one place: full-stack example apps plus focused demos for hydration, data, endpoints, forms and errors.',
    canonical: 'https://mochi.fast/demos/',
  }}
>
  <div class="wrap">
    <header class="page-head">
      <h1>Demos</h1>
      <p>Every demo is a real Mochi page with its source alongside. Start with a full-stack app, or jump to a feature.</p>
      <nav class="jump" aria-label="Demo categories">
        <a href="#full-stack-demos">Full-stack demos</a>
        {#each groups as group (group.id)}
          <a href="#{group.id}">{group.label} <span class="count">{group.demos.length}</span></a>
        {/each}
      </nav>
    </header>

    <section class="group" id="full-stack-demos" aria-labelledby="full-stack-demos-title">
      <h2 id="full-stack-demos-title">Full-stack demos</h2>
      <p class="group-lede">Production-style apps you can poke at live, built on the same primitives the docs cover.</p>
      <ul class="demo-grid">
        {#each fullStack as demo (demo.href)}
          <li><DemoCard href={demo.href} title={demo.title} label={demo.hook} icon={demo.icon} external /></li>
        {/each}
      </ul>
      <p class="share">Built something with Mochi? Share it in the <a href="/discord/">Mochi Discord</a>. We're happy to feature it.</p>
    </section>

    {#each groups as group (group.id)}
      <section class="group" id={group.id} aria-labelledby="{group.id}-title">
        <h2 id="{group.id}-title">{group.label}</h2>
        <ul class="demo-grid">
          {#each group.demos as demo (demo.href)}
            <li><DemoCard href={demo.href} title={demo.title} label={demo.label} icon={demo.icon} /></li>
          {/each}
        </ul>
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
  h2 {
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
    letter-spacing: -0.025em;
    margin-bottom: 0.75rem;
  }

  .page-head p {
    max-width: 44rem;
    font-size: 1.12rem;
    line-height: 1.55;
    color: var(--text-muted);
    text-wrap: pretty;
  }

  .jump {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 1.5rem;
  }

  .jump a {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-muted);
    font-size: 0.875rem;
    font-weight: 500;
    text-decoration: none;
    transition:
      border-color 0.15s ease,
      color 0.15s ease;
  }

  .jump a:hover {
    border-color: var(--accent);
    color: var(--text);
  }

  .jump a:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .count {
    font-size: 0.75rem;
    color: var(--text-subtle);
    font-variant-numeric: tabular-nums;
  }

  .group {
    padding-top: 2.75rem;
    scroll-margin-top: 4.5rem;
  }

  .group + .group {
    margin-top: 0.5rem;
    border-top: 1px solid var(--border);
  }

  .group h2 {
    font-size: clamp(1.5rem, 2.6vw, 1.9rem);
    line-height: 1.15;
    margin-bottom: 1.1rem;
  }

  .group-lede {
    margin: -0.5rem 0 1.25rem;
    color: var(--text-muted);
  }

  .demo-grid {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .demo-grid li {
    display: flex;
  }

  .share {
    margin-top: 1.1rem;
    font-size: 0.92rem;
    color: var(--text-subtle);
  }

  .share a {
    color: var(--accent);
  }

  @media (max-width: 1024px) {
    .demo-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 720px) {
    .wrap {
      padding: 0 1rem 3.5rem;
    }

    .page-head {
      padding-top: 2.5rem;
    }

    .demo-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
