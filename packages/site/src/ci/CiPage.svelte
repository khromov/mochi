<script lang="ts">
  import Footer from '../components/Footer.svelte';
  import PageShell from '../components/PageShell.svelte';
  import type { CiDashboardData, CiRateLimit } from '../lib/ci';
  import type { TocEntry } from '../lib/toc';
  import CiDashboard from './CiDashboard.svelte';
  import { CI_BRANCH, CI_REPO } from './repo';

  let {
    docsNav,
    dashboard,
    rateLimit,
    serverNow,
  }: {
    docsNav: TocEntry[];
    dashboard: CiDashboardData | null;
    rateLimit: CiRateLimit | null;
    serverNow: number;
  } = $props();
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<PageShell
  {docsNav}
  metaTags={{
    title: 'CI Status',
    description: `GitHub Actions status for ${CI_REPO}.`,
    canonical: 'https://mochi.fast/ci/',
    robots: 'noindex, nofollow',
  }}
>
  <header class="hero-minimal">
    <div class="hero-inner">
      <a class="logo" href="/">🍡 mochi</a>
      <p class="tagline">SSR framework for Svelte 5 + Bun with islands-based selective hydration</p>
    </div>
  </header>

  <main class="body">
    <h1>CI Status</h1>
    <p class="lede">GitHub Actions on <code>{CI_REPO}</code>, branch <code>{CI_BRANCH}</code>.</p>

    <CiDashboard mochi:hydrate {dashboard} {rateLimit} {serverNow} />
  </main>

  <Footer />
</PageShell>

<style>
  .hero-minimal {
    padding: 1.5rem 1.5rem;
  }

  .hero-inner {
    position: relative;
    max-width: 600px;
    margin: 0 auto;
  }

  .logo {
    display: inline-block;
    font-family: var(--font-serif);
    font-size: 3.25rem;
    font-weight: 400;
    font-variation-settings:
      'opsz' 144,
      'SOFT' 50;
    color: #fff;
    letter-spacing: -0.015em;
    margin-bottom: 0.5rem;
    text-decoration: none;
  }

  .tagline {
    font-family: var(--font-serif);
    font-weight: 300;
    color: #d8e4dc;
    font-size: 1.05rem;
    line-height: 1.5;
    letter-spacing: 0.005em;
    margin-bottom: 0;
  }

  .body {
    max-width: 1100px;
    width: 100%;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    flex: 1;
    color: var(--text);
  }

  h1 {
    font-family: var(--font-serif);
    font-size: 2.25rem;
    font-weight: 400;
    /* Fraunces' low optical size is the plain (non-decorated) cut of the face. */
    font-variation-settings: 'opsz' 9;
    margin: 0 0 0.35rem;
    letter-spacing: -0.01em;
  }

  .lede {
    margin: 0 0 1.5rem;
    color: var(--text-muted);
  }

  .lede code {
    font-family: var(--font-mono);
    font-size: 0.85em;
  }

  @media (max-width: 768px) {
    .hero-minimal {
      padding: 1rem 1.25rem;
    }

    .logo {
      font-size: 2.2rem;
    }

    .body {
      max-width: none;
      background: var(--surface);
    }

    h1 {
      font-size: 1.875rem;
    }
  }
</style>
