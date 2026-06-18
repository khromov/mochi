<script lang="ts">
  import { localePath, LOCALES, type PageId } from './nav.ts';

  let { locale, page }: { locale: string; page: PageId } = $props();
</script>

<header class="topbar">
  <a class="brand" href={localePath(locale, 'home')}>
    <span class="logo" aria-hidden="true">🍡</span><span>mochi</span>
  </a>

  <nav class="menu" aria-label="Main">
    <a href={localePath(locale, 'home')} class:active={page === 'home'}>Home</a>
    <a href={localePath(locale, 'about')} class:active={page === 'about'}>About</a>
    <a href="https://mochi.fast" target="_blank" rel="noopener noreferrer">Documentation</a>
  </nav>

  <div class="langs" aria-label="Choose language">
    <span class="langs-label">Language</span>
    {#each LOCALES as lang (lang.code)}
      <a href={localePath(lang.code, page)} class:current={lang.code === locale} hreflang={lang.code}>
        {lang.name}
      </a>
    {/each}
  </div>
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
    padding: 18px 28px;
    border-bottom: 1px solid var(--rule, #e6e0d2);
  }
  .brand {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    font-family: var(--font-serif, 'Fraunces', serif);
    font-weight: 600;
    font-size: 20px;
    text-decoration: none;
    color: var(--ink, #2a2825);
  }
  .menu {
    display: flex;
    gap: 18px;
    margin-left: auto;
    font-size: 14px;
  }
  .menu a {
    color: var(--ink-soft, #6b665e);
    text-decoration: none;
    padding-bottom: 2px;
    border-bottom: 2px solid transparent;
  }
  .menu a:hover {
    color: var(--green-700, #385c47);
  }
  .menu a.active {
    color: var(--green-700, #385c47);
    border-bottom-color: var(--green-700, #385c47);
  }
  .langs {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
  }
  .langs-label {
    font-weight: 600;
    color: var(--ink-faint, #a39e94);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 11px;
  }
  .langs a {
    color: var(--ink-soft, #6b665e);
    text-decoration: none;
  }
  .langs a.current {
    color: var(--green-700, #385c47);
    font-weight: 600;
    text-decoration: underline;
  }
</style>
