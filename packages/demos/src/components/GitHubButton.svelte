<script lang="ts">
  let { href = 'https://github.com/khromov/mochi' }: { href?: string } = $props();
</script>

<a class="gh-button" {href} target="_blank" rel="noopener noreferrer" aria-label="View source on GitHub">
  <svg viewBox="108 34 114 114" aria-hidden="true">
    <path
      class="octo-arm"
      fill="currentColor"
      d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.9,78.5 120.9,78.5 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2"
    />
    <path
      fill="currentColor"
      d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.8 141.5,141.9 141.8,141.8 Z"
    />
  </svg>
</a>

<style>
  .gh-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    background: transparent;
    border: 1px solid var(--rule, #e6e0d2);
    border-radius: 999px;
    color: var(--ink, #2a2825);
    cursor: pointer;
    flex-shrink: 0;
    box-shadow: 0 1px 2px rgba(42, 40, 37, 0.05);
    transition:
      color 0.12s ease,
      border-color 0.12s ease,
      box-shadow 0.12s ease;
  }

  .gh-button:hover {
    border-color: var(--ink-faint, #a39e94);
    box-shadow: 0 1px 3px rgba(42, 40, 37, 0.08);
  }

  .gh-button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(42, 40, 37, 0.12);
  }

  .gh-button svg {
    width: 18px;
    height: 18px;
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
</style>
