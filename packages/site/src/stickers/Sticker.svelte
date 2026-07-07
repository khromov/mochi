<script>
  import '@fontsource-variable/fraunces/full.css';
</script>

<svelte:head>
  <title>Sticker — Mochi</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
</svelte:head>

{#snippet card()}
  <div class="sticker-canvas">
    <div class="sticker-inner">
      <span class="sticker-logo">🍡 mochi</span>
      <span class="sticker-tag">Svelte meta-framework</span>
      <span class="sticker-url">mochi.fast</span>
    </div>
  </div>
{/snippet}

<div class="sticker-page">
  <h1 class="page-title">Stickers</h1>
  <p class="page-desc">720 × 405 (16:9) — 3 × 3 print sheet, screenshot or print the grid below</p>

  <div class="sticker-grid">
    {#each Array(9) as _, i (i)}
      {@render card()}
    {/each}
  </div>
</div>

<style>
  .sticker-page {
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

  .sticker-grid {
    display: grid;
    grid-template-columns: repeat(3, max-content);
    gap: 1rem;
    width: max-content;
  }

  .sticker-canvas {
    width: 720px;
    height: 405px;
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
    border: 18px solid #fff;
    border-radius: 28px;
    /* Slim black cut-line around the outer edge of the white border. */
    box-shadow: 0 0 0 1.5px #000;
  }

  /* Sized to the logo so the URL can right-align directly under its final glyph. */
  .sticker-inner {
    display: inline-block;
  }

  .sticker-logo {
    display: block;
    font-family: 'Fraunces Variable', Georgia, 'Times New Roman', serif;
    font-size: 10rem;
    font-weight: 400;
    font-variation-settings:
      'opsz' 144,
      'SOFT' 50,
      'WONK' 1;
    color: #fff;
    letter-spacing: -0.015em;
    line-height: 1.05;
  }

  .sticker-tag {
    display: block;
    text-align: right;
    margin-top: 0.75rem;
    font-family: 'Fraunces Variable', Georgia, 'Times New Roman', serif;
    font-style: italic;
    font-weight: 300;
    font-size: 2rem;
    color: rgba(255, 255, 255, 0.82);
    letter-spacing: 0.003em;
  }

  .sticker-url {
    display: block;
    text-align: right;
    margin-top: 0.35rem;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 2rem;
    color: rgba(255, 255, 255, 0.92);
    letter-spacing: 0.04em;
  }

  /* Print just the grid, one 3×3 sheet, with the page chrome dropped. */
  @media print {
    .sticker-page {
      padding: 0;
    }

    .page-title,
    .page-desc {
      display: none;
    }
  }
</style>
