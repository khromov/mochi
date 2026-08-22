<script lang="ts">
  let { compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void } = $props();
</script>

<a class="gh-button" class:compact href="https://github.com/khromov/mochi" target="_blank" rel="noopener noreferrer" aria-label="View source on GitHub" onclick={onNavigate}>
  <svg viewBox="108 34 114 114" aria-hidden="true">
    <use class="octo-arm" href="/gh-corner.svg#gh-corner-arm"></use>
    <use href="/gh-corner.svg#gh-corner-body"></use>
  </svg>
</a>

<style>
  .gh-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
    transition:
      color 0.12s ease,
      background 0.12s ease,
      border-color 0.12s ease;
  }

  .gh-button:hover {
    background: var(--accent-soft);
    color: var(--accent-soft-text);
    border-color: var(--accent);
  }

  .gh-button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .gh-button svg {
    width: 17px;
    height: 17px;
    fill: currentColor;
    /* The corner artwork peeks diagonally; rotate it upright for the round button. */
    transform: rotate(-45deg);
  }

  .octo-arm {
    transform-box: view-box;
    transform-origin: 130px 106px;
  }

  .gh-button:hover .octo-arm,
  .gh-button:focus-visible .octo-arm {
    animation: octocat-wave 560ms ease-in-out;
  }

  @keyframes octocat-wave {
    0%,
    100% {
      transform: rotate(0);
    }
    20%,
    60% {
      transform: rotate(-25deg);
    }
    40%,
    80% {
      transform: rotate(10deg);
    }
  }

  .compact {
    width: 30px;
    height: 30px;
  }
</style>
