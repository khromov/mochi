<script>
  import '@fontsource-variable/fraunces/full.css';
</script>

<svelte:head>
  <title>OG Image Generator — Mochi</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="og-page">
  <h1 class="page-title">OG Image Preview</h1>
  <p class="page-desc">1200 × 630 — screenshot the card below</p>

  <div class="canvas-wrap">
    <div id="og-canvas" class="og-canvas">
      <div class="og-inner">
        <span class="og-logo">🍡 mochi</span>
        <p class="og-lede">
          A new SSR-first framework for
          <span class="nowrap">Svelte 5</span> and <span class="nowrap">Bun</span>.
        </p>
        <p class="og-dek">Partial Hydration · Best-in-class performance · full SSR support · Forms · Realtime WebSockets and SSE</p>
        <span class="og-url">mochi.fast</span>
      </div>
    </div>
  </div>
</div>

<style>
  .og-page {
    margin: 0;
    padding: 2rem;
    font-family: var(--font-sans, system-ui);
  }

  .page-title {
    font-family: var(--font-serif);
    font-size: 1.5rem;
    font-weight: 500;
    color: var(--text);
    margin-bottom: 0.25rem;
  }

  .page-desc {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin-bottom: 1.5rem;
  }

  .canvas-wrap {
    display: inline-block;
    line-height: 0;
  }

  .og-canvas {
    width: 1200px;
    height: 630px;
    display: flex;
    align-items: center;
    justify-content: center;

    background-color: #2b3d33;
    background-image:
      url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>"),
      linear-gradient(135deg, #2b3d33 0%, #4a7c59 100%);
    background-size:
      240px 240px,
      auto;
    background-blend-mode: soft-light, normal;
    text-align: center;
    overflow: hidden;
  }

  .og-inner {
    max-width: 960px;
    padding: 0 4rem;
  }

  .og-logo {
    display: block;
    font-family: 'Fraunces Variable', Georgia, 'Times New Roman', serif;
    font-size: 8rem;
    font-weight: 400;
    font-variation-settings:
      'opsz' 144,
      'SOFT' 50,
      'WONK' 1;
    color: #fff;
    letter-spacing: -0.015em;
    margin-bottom: 1rem;
    line-height: 1.05;
  }

  .og-lede {
    font-family: 'Fraunces Variable', Georgia, 'Times New Roman', serif;
    font-weight: 400;
    color: #fff;
    font-size: 3rem;
    line-height: 1.25;
    letter-spacing: -0.003em;
    margin-bottom: 0.85rem;
    text-wrap: balance;
  }

  .og-dek {
    font-family: 'Fraunces Variable', Georgia, 'Times New Roman', serif;
    font-style: italic;
    font-weight: 300;
    color: #e0e8e2;
    font-size: 1.85rem;
    line-height: 1.4;
    letter-spacing: 0.003em;
    text-wrap: balance;
  }

  .og-url {
    display: inline-block;
    margin-top: 2rem;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 1.4rem;
    color: rgba(224, 232, 226, 0.7);
    letter-spacing: 0.04em;
  }

  .nowrap {
    white-space: nowrap;
  }
</style>
