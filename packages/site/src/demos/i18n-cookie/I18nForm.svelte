<script lang="ts">
  import { cookies, isBrowser } from 'mochi-framework';
  // setLocale comes from the Mochi-generated client loader; it swaps the
  // active catalog in place (all locales are bundled) so this island
  // re-renders instantly, with no page reload.
  import { setLocale } from './locales/main.loader.svelte.js';

  const LANGS = [
    { code: 'en', name: 'English' },
    { code: 'sv', name: 'Svenska' },
    { code: 'uk', name: 'Українська' },
  ];

  let { initialLocale = 'en' }: { initialLocale?: string } = $props();
  // svelte-ignore state_referenced_locally
  let current = $state(initialLocale);

  function choose(code: string) {
    current = code;
    setLocale(code);
    // Persist the choice so the next SSR render picks the same language.
    if (isBrowser) {
      cookies.set('mochi_locale', code, { expires: 365, path: '/' });
    }
  }
</script>

<div class="i18n-cookie">
  <h3 class="hi">Good day, and welcome to Mochi!</h3>
  <p class="lead">This panel re-translates itself instantly when you switch languages — no page reload.</p>
  <p class="note">Your choice is stored in a cookie, so the server renders this page in your language next time you visit.</p>

  <div class="switcher" role="group" aria-label="Choose your language">
    <span class="label">Language</span>
    {#each LANGS as lang (lang.code)}
      <button type="button" class:active={lang.code === current} onclick={() => choose(lang.code)}>
        {lang.name}
      </button>
    {/each}
  </div>

  <p class="current">Active language code: <code>{current}</code></p>
</div>

<style>
  .i18n-cookie {
    border: 1px solid var(--rule, #e3ded2);
    border-radius: 12px;
    padding: 22px 24px;
    background: var(--bg-card, #fff);
  }
  .hi {
    margin: 0 0 8px;
    font-size: 20px;
  }
  .lead {
    margin: 0 0 6px;
  }
  .note {
    margin: 0 0 18px;
    color: var(--ink-soft, #6b665e);
    font-size: 14px;
  }
  .switcher {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .label {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-faint, #a39e94);
    margin-right: 4px;
  }
  .switcher button {
    font: inherit;
    padding: 6px 14px;
    border-radius: 999px;
    border: 1px solid var(--rule, #d8d2c4);
    background: transparent;
    color: var(--ink, #2a2825);
    cursor: pointer;
  }
  .switcher button.active {
    border-color: var(--accent, #4a7159);
    background: var(--accent, #4a7159);
    color: #fff;
    font-weight: 600;
  }
  .current {
    margin: 16px 0 0;
    font-size: 13px;
    color: var(--ink-soft, #6b665e);
  }
</style>
