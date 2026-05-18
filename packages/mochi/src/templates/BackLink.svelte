<script lang="ts">
  import { onMount } from 'svelte';

  // SSR renders "Go home →" (safe fallback). After hydration, if the user
  // navigated here from somewhere on this site, swap to "Go back" and wire
  // the click to history.back().
  let showBack = $state(false);

  onMount(() => {
    showBack = document.referrer !== '' && document.referrer.startsWith(location.origin);
  });

  function handleClick(e: MouseEvent) {
    if (showBack) {
      e.preventDefault();
      history.back();
    }
  }
</script>

<a href="/" onclick={handleClick}>
  {showBack ? '← Go back' : 'Go home →'}
</a>

<style>
  a {
    display: inline-block;
    font-size: 15px;
    font-weight: 500;
    color: #1d1d1f;
    text-decoration: none;
    border-bottom: 1px solid currentColor;
    padding-bottom: 2px;
    transition: opacity 0.15s;
  }
  a:hover {
    opacity: 0.7;
  }
  @media (max-width: 480px) {
    a {
      font-size: 14px;
    }
  }
  @media (prefers-color-scheme: dark) {
    a {
      color: #f5f5f7;
    }
  }
</style>
