<script>
  import '@fontsource-variable/fraunces/full.css';
  import StickerLogoExport from './StickerLogoExport.svelte';
  import { dangoDataUri } from './dango';
</script>

<svelte:head>
  <title>Logo — Mochi</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="logo-page">
  <StickerLogoExport mochi:hydrate targetId="logo-canvas" wordmarkId="logo-wordmark" />

  <div id="logo-canvas" class="logo-canvas">
    <img class="logo-dango" src={dangoDataUri} alt="" />
    <div id="logo-wordmark" class="logo-wordmark">
      <span class="logo-text">mochi</span>
      <span class="logo-fast">.fast</span>
    </div>
  </div>
</div>

<style>
  .logo-page {
    margin: 0;
    padding: 2rem;
  }

  .logo-canvas {
    width: 800px;
    height: 800px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    /* On-page backdrop only — the export strips it so the PNG stays transparent. */
    background: #fff;
  }

  .logo-dango {
    width: 340px;
    height: 340px;
  }

  /* Sized to the wordmark so .fast can right-align under mochi's final glyph. */
  .logo-wordmark {
    display: inline-block;
  }

  .logo-text {
    display: block;
    font-family: 'Fraunces Variable', Georgia, 'Times New Roman', serif;
    font-size: 170px;
    font-weight: 400;
    font-variation-settings:
      'opsz' 144,
      'SOFT' 50,
      'WONK' 1;
    color: #000;
    letter-spacing: -0.015em;
    line-height: 1.05;
  }

  .logo-fast {
    display: block;
    text-align: right;
    margin-top: -14px;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 56px;
    font-weight: 700;
    color: #000;
    letter-spacing: 0.04em;
  }
</style>
