<script lang="ts">
  import { getRequestContext } from 'mochi-framework';
  import mochiPkg from 'mochi-framework/package.json' with { type: 'json' };
  import Leaves from './components/Leaves.svelte';

  const { url } = getRequestContext();
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,500;0,600;1,400&family=Public+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
  />
</svelte:head>

<Leaves mochi:hydrate />

<header class="topbar">
  <a href="/" class="brand">
    <span class="logo">🍡</span><span>mochi</span>
  </a>
</header>

<main class="stage">
  <section class="card">
    <h1 class="greeting">
      <span class="dango" aria-hidden="true">🍡</span><span>Hello Mochi!</span>
    </h1>
    <p class="subhead">
      Your Mochi app is up and running.<br />
      Edit the file below to make it your own.
    </p>
    <div class="meta">
      <span class="pulse" aria-hidden="true"></span>
      <span>{url.host}</span>
    </div>
    <div class="divider"></div>
    <div class="you-are-editing">
      <div>
        <div class="label">You are editing</div>
        <div class="filepath">
          <span class="seg">src</span><span class="sep">/</span><span class="leaf">HelloWorld.svelte</span>
        </div>
      </div>
    </div>
    <div class="links">
      <a href="https://mochi.fast" target="_blank" rel="noopener noreferrer">Documentation</a>
      <a href="https://mochi.fast/docs/demos" target="_blank" rel="noopener noreferrer">Demos</a>
      <a href="https://github.com/khromov/mochi" target="_blank" rel="noopener noreferrer">GitHub</a>
    </div>
  </section>
  <div class="footer-version">mochi v{mochiPkg.version} · MIT</div>
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
    --font-serif: 'Fraunces', serif;
    --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    font-family:
      'Public Sans',
      -apple-system,
      BlinkMacSystemFont,
      sans-serif;
    background: radial-gradient(1200px 600px at 50% -10%, rgba(56, 92, 71, 0.1), transparent 60%), var(--bg);
    color: var(--ink);
    font-size: 15px;
    line-height: 1.55;
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
    isolation: isolate;
  }

  .topbar {
    padding: 22px 28px;
  }

  .brand {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    font-family: var(--font-serif);
    font-weight: 600;
    font-size: 20px;
    text-decoration: none;
    color: var(--ink);
  }

  .brand .logo {
    line-height: 1;
    transform: translateY(2px);
  }

  .stage {
    min-height: calc(100vh - 78px);
    display: grid;
    place-items: center;
    padding: 24px 24px 60px;
  }

  .card {
    width: min(560px, 100%);
    background: var(--bg-card);
    border: 1px solid var(--rule);
    border-radius: 14px;
    padding: 44px 44px 38px;
    box-shadow:
      0 1px 0 rgba(42, 40, 37, 0.04),
      0 30px 60px -28px rgba(42, 40, 37, 0.18),
      0 12px 24px -16px rgba(42, 40, 37, 0.1);
    text-align: center;
  }

  .greeting {
    font-family: var(--font-serif);
    font-weight: 500;
    font-size: 46px;
    line-height: 1.05;
    letter-spacing: -0.025em;
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }

  .greeting .dango {
    font-size: 40px;
    line-height: 1;
    transform: translateY(2px) rotate(-8deg);
    display: inline-block;
    animation: bob 4s ease-in-out infinite;
  }

  @keyframes bob {
    0%,
    100% {
      transform: translateY(2px) rotate(-8deg);
    }
    50% {
      transform: translateY(-4px) rotate(-4deg);
    }
  }

  .subhead {
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 17px;
    color: var(--ink-soft);
    margin: 16px auto 0;
    max-width: 420px;
  }

  .meta {
    margin-top: 22px;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 6px 13px 6px 10px;
    border-radius: 999px;
    background: var(--green-100);
    border: 1px solid var(--green-200);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--green-700);
  }

  .meta .pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--green-600);
    animation: pulse 1.8s ease-out infinite;
  }

  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(74, 113, 89, 0.45);
    }
    100% {
      box-shadow: 0 0 0 10px rgba(74, 113, 89, 0);
    }
  }

  .divider {
    height: 1px;
    background: var(--rule);
    margin: 30px -44px 24px;
  }

  .you-are-editing {
    text-align: left;
  }

  .label {
    font-family: var(--font-serif);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }

  .filepath {
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: 14px;
  }

  .filepath .seg {
    color: var(--ink-soft);
  }
  .filepath .sep {
    color: var(--ink-faint);
    padding: 0 2px;
  }
  .filepath .leaf {
    color: var(--green-700);
    background: var(--green-100);
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 500;
  }

  .links {
    margin-top: 22px;
    display: flex;
    justify-content: center;
    gap: 22px;
    flex-wrap: wrap;
    font-size: 13px;
  }

  .links a {
    color: var(--ink-soft);
    text-decoration: none;
    border-bottom: 1px dotted var(--ink-faint);
  }

  .links a:hover {
    color: var(--green-700);
    border-color: var(--green-700);
  }

  .footer-version {
    margin-top: 24px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--ink-faint);
    text-align: center;
  }

  @media (max-width: 640px) {
    .card {
      padding: 32px 22px 28px;
      width: min(440px, 100%);
    }
    .divider {
      margin: 24px -22px 18px;
    }
    .greeting {
      font-size: 36px;
      gap: 10px;
    }
    .greeting .dango {
      font-size: 30px;
    }
  }
</style>
