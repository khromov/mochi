<script lang="ts">
  import '@fontsource-variable/fraunces/full.css';
  import '@fontsource-variable/public-sans';
  import { localePath, LOCALES, type PageId } from './nav.ts';
  import GitHubButton from '../components/GitHubButton.svelte';
  import Globe from '@lucide/svelte/icons/globe';

  let { locale, page }: { locale: string; page: PageId } = $props();

  const current = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];
</script>

<header class="topbar">
  <a class="brand" href={localePath(locale, 'home')}>
    <span class="logo" aria-hidden="true">🍡</span><span>mochi</span>
  </a>

  <nav class="menu" aria-label="Main">
    <a href={localePath(locale, 'home')} class="pill" class:active={page === 'home'}>Home</a>
    <a href={localePath(locale, 'about')} class="pill" class:active={page === 'about'}>About</a>
    <a href={localePath(locale, 'demos')} class="pill" class:active={page === 'demos'}>Demos</a>
  </nav>

  <details class="langs">
    <summary aria-label="Choose language">
      <Globe class="globe" size={16} aria-hidden="true" />
      <span class="langs-current">{current.name}</span>
      <span class="caret" aria-hidden="true">▾</span>
    </summary>
    <div class="langs-menu" role="menu">
      {#each LOCALES as lang (lang.code)}
        <a href={localePath(lang.code, page)} class:current={lang.code === locale} hreflang={lang.code} role="menuitem">
          {lang.name}
        </a>
      {/each}
    </div>
  </details>

  <div class="gh-slot">
    <GitHubButton />
  </div>
</header>

<style>
  /* Replace the shell's fixed corner octocat with the circular nav button below. */
  :global(.gh-corner) {
    display: none;
  }

  .topbar {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    padding: 18px 28px;
    border-bottom: 1px solid var(--rule, #e6e0d2);
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-serif, 'Fraunces Variable', serif);
    font-weight: 600;
    font-size: 20px;
    text-decoration: none;
    color: var(--ink, #2a2825);
  }
  .brand .logo {
    font-size: 22px;
    line-height: 1;
  }

  .menu {
    display: flex;
    gap: 8px;
    margin-left: auto;
    font-size: 14px;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    padding: 7px 14px;
    border-radius: 999px;
    border: 1px solid var(--rule, #e6e0d2);
    background: transparent;
    color: var(--ink, #2a2825);
    text-decoration: none;
    box-shadow: 0 1px 2px rgba(42, 40, 37, 0.05);
    transition:
      border-color 0.12s ease,
      box-shadow 0.12s ease;
  }
  .pill:hover {
    border-color: var(--ink-faint, #a39e94);
    box-shadow: 0 1px 3px rgba(42, 40, 37, 0.08);
  }
  .pill.active {
    border-color: var(--ink, #2a2825);
    box-shadow: 0 1px 3px rgba(42, 40, 37, 0.08);
    font-weight: 600;
  }

  .langs {
    position: relative;
  }
  .langs summary {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 7px 12px;
    border-radius: 999px;
    border: 1px solid var(--rule, #e6e0d2);
    background: transparent;
    color: var(--ink, #2a2825);
    font-size: 13px;
    cursor: pointer;
    list-style: none;
    user-select: none;
    box-shadow: 0 1px 2px rgba(42, 40, 37, 0.05);
    transition:
      border-color 0.12s ease,
      box-shadow 0.12s ease;
  }
  .langs summary::-webkit-details-marker {
    display: none;
  }
  .langs summary:hover {
    border-color: var(--ink-faint, #a39e94);
    box-shadow: 0 1px 3px rgba(42, 40, 37, 0.08);
  }
  .globe {
    flex-shrink: 0;
  }
  .langs-current {
    font-weight: 600;
  }
  .caret {
    font-size: 10px;
    transition: transform 0.12s ease;
  }
  .langs[open] .caret {
    transform: rotate(180deg);
  }

  .langs-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 160px;
    display: flex;
    flex-direction: column;
    padding: 6px;
    border-radius: 12px;
    border: 1px solid var(--rule, #e6e0d2);
    background: var(--bg-card, #fbf8f1);
    box-shadow: 0 16px 32px -16px rgba(42, 40, 37, 0.32);
    z-index: 20;
  }
  .langs-menu a {
    padding: 8px 10px;
    border-radius: 8px;
    color: var(--ink, #2a2825);
    text-decoration: none;
    font-size: 14px;
  }
  .langs-menu a:hover {
    background: rgba(42, 40, 37, 0.06);
  }
  .langs-menu a.current {
    font-weight: 600;
    background: rgba(42, 40, 37, 0.06);
  }

  .gh-slot {
    display: inline-flex;
  }

  @media (max-width: 640px) {
    .topbar {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      grid-template-areas:
        'lang brand gh'
        'menu menu menu';
      gap: 12px;
      padding: 10px 14px;
    }
    .langs {
      grid-area: lang;
      justify-self: start;
    }
    .langs summary {
      gap: 0;
      padding: 8px;
    }
    .langs-current,
    .caret {
      display: none;
    }
    .brand {
      grid-area: brand;
      justify-self: center;
    }
    .gh-slot {
      grid-area: gh;
      justify-self: end;
    }
    .menu {
      grid-area: menu;
      justify-self: center;
      margin-left: 0;
      flex-wrap: wrap;
      justify-content: center;
    }
    .langs-menu {
      left: 0;
      right: auto;
    }
  }
</style>
