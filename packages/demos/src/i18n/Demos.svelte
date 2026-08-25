<script lang="ts">
  import { getRequestContext } from 'mochi-framework';
  import Nav from './Nav.svelte';
  import { localePath } from './nav.ts';

  const { locals } = getRequestContext();
  const locale = (locals.locale as string) ?? 'en';
</script>

<svelte:head>
  <title>Mochi · Demos</title>
</svelte:head>

<Nav {locale} page="demos" />

<main class="stage">
  <section class="card">
    <h1 class="greeting">More demos</h1>
    <p class="subhead">This is just another translated page, here to show the menu can grow. Find all the other Mochi demos on the <a href="/">home page</a>.</p>

    <nav class="pager" aria-label="Pagination">
      <a class="prev" href={localePath(locale, 'about')}>← Previous page: About</a>
      <span></span>
    </nav>
  </section>
</main>

<style>
  :global(:root) {
    --bg: #f1ecdf;
    --bg-card: #fbf8f1;
    --ink: #2a2825;
    --ink-soft: #6b665e;
    --ink-faint: #a39e94;
    --rule: #e6e0d2;
    --green-700: #385c47;
    --green-600: #4a7159;
    --green-200: #d6e4d8;
    --green-100: #e8efe5;
    --font-serif: 'Fraunces Variable', Georgia, serif;
  }
  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family:
      'Public Sans',
      -apple-system,
      BlinkMacSystemFont,
      sans-serif;
    min-height: 100vh;
  }
  .stage {
    display: grid;
    place-items: center;
    padding: 40px 24px 64px;
  }
  .card {
    box-sizing: border-box;
    width: min(620px, 100%);
    background: var(--bg-card);
    border: 1px solid var(--rule);
    border-radius: 14px;
    padding: 40px;
    box-shadow: 0 30px 60px -30px rgba(42, 40, 37, 0.22);
  }
  .greeting {
    font-family: var(--font-serif);
    font-weight: 500;
    font-size: 34px;
    line-height: 1.1;
    margin: 0 0 14px;
  }
  .subhead {
    font-size: 16px;
    color: var(--ink-soft);
    margin: 0;
  }
  .subhead a {
    color: var(--green-700);
    font-weight: 600;
  }
  .pager {
    display: flex;
    justify-content: space-between;
    margin-top: 28px;
    font-size: 14px;
  }
  .pager a {
    color: var(--green-700);
    text-decoration: none;
    font-weight: 600;
  }
  .pager a:hover {
    text-decoration: underline;
  }

  @media (max-width: 640px) {
    .stage {
      padding: 16px 14px 40px;
    }
    .card {
      padding: 24px 20px;
      border-radius: 12px;
    }
    .greeting {
      font-size: 27px;
    }
  }
</style>
