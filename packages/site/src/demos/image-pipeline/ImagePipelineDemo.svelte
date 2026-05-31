<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils.ts';

  const CDN = 'https://sta-public.fra1.cdn.digitaloceanspaces.com/mochi';
  const srcUrl = (n) => `${CDN}/mochi-${n}.jpg`;

  const cache = Object.create(null);
  async function fetchBytes(n) {
    const url = srcUrl(n);
    if (!cache[url]) {
      cache[url] = new Uint8Array(await (await fetch(url)).arrayBuffer());
    }
    return cache[url];
  }

  // Each pipeline gets a fresh `Bun.Image` over a sliced copy — the decode borrows the
  // buffer off-thread, so reusing one view across pipelines is unsafe.
  async function image(n) {
    return new Bun.Image((await fetchBytes(n)).slice());
  }

  function toDataUrl(bytes, mime) {
    return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  }

  async function render(n, build, mime) {
    const bytes = await build(await image(n)).bytes();
    return { url: toDataUrl(bytes, mime), size: bytes.length };
  }

  // AVIF/HEIC encode is gated to the OS backend (Apple Silicon M3+, updated Windows);
  // everywhere else the terminal rejects with ERR_IMAGE_FORMAT_UNSUPPORTED.
  async function tryRender(n, build, mime) {
    try {
      return await render(n, build, mime);
    } catch (e) {
      if (e?.code === 'ERR_IMAGE_FORMAT_UNSUPPORTED') {
        return null;
      }
      throw e;
    }
  }

  async function du(n, build, mime = 'image/webp') {
    return (await render(n, build, mime)).url;
  }

  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

  // 1 — metadata (no pixels decoded)
  const meta = await (await image(1)).metadata();
  const metaImg = await du(1, (im) => im.resize(260, 260, { fit: 'inside' }).webp());

  // 2 — fit
  const fitFill = await du(2, (im) => im.resize(240, 240, { fit: 'fill' }).webp());
  const fitInside = await du(2, (im) => im.resize(240, 240, { fit: 'inside' }).webp());

  // 3 — resample filter (downscale then upscale to make the kernel visible)
  const filterNearest = await du(3, (im) => im.resize(56, 56, { fit: 'inside' }).resize(240, 240, { fit: 'fill', filter: 'nearest' }).webp());
  const filterLanczos = await du(3, (im) => im.resize(56, 56, { fit: 'inside' }).resize(240, 240, { fit: 'fill', filter: 'lanczos3' }).webp());

  // 4 — rotate
  const rotate90 = await du(4, (im) => im.resize(200, 200, { fit: 'inside' }).rotate(90).webp());
  const rotate180 = await du(4, (im) => im.resize(200, 200, { fit: 'inside' }).rotate(180).webp());
  const rotate270 = await du(4, (im) => im.resize(200, 200, { fit: 'inside' }).rotate(270).webp());

  // 5 — flip / flop
  const flipOriginal = await du(5, (im) => im.resize(200, 200, { fit: 'inside' }).webp());
  const flipped = await du(5, (im) => im.resize(200, 200, { fit: 'inside' }).flip().webp());
  const flopped = await du(5, (im) => im.resize(200, 200, { fit: 'inside' }).flop().webp());

  // 6 — modulate
  const modGrey = await du(7, (im) => im.resize(200, 200, { fit: 'inside' }).modulate({ saturation: 0 }).webp());
  const modBright = await du(7, (im) => im.resize(200, 200, { fit: 'inside' }).modulate({ brightness: 1.5 }).webp());
  const modSaturate = await du(7, (im) => im.resize(200, 200, { fit: 'inside' }).modulate({ saturation: 2 }).webp());

  // 7 — output formats + size, same source/size for a fair comparison
  const FMT_SRC = 9;
  const fmt = (build, mime) => render(FMT_SRC, (im) => build(im.resize(300, 300, { fit: 'inside' })), mime);
  const tryFmt = (build, mime) => tryRender(FMT_SRC, (im) => build(im.resize(300, 300, { fit: 'inside' })), mime);
  const formats = [
    { label: 'jpeg({ quality: 85 })', out: await fmt((im) => im.jpeg({ quality: 85 }), 'image/jpeg') },
    { label: 'png()', out: await fmt((im) => im.png(), 'image/png') },
    { label: 'webp({ quality: 80 })', out: await fmt((im) => im.webp({ quality: 80 }), 'image/webp') },
    { label: 'avif({ quality: 50 })', out: await tryFmt((im) => im.avif({ quality: 50 }), 'image/avif') },
    { label: 'heic({ quality: 50 })', out: await tryFmt((im) => im.heic({ quality: 50 }), 'image/heic') },
  ];

  // 8 — indexed-palette PNG
  const pngTruecolor = await render(11, (im) => im.resize(300, 300, { fit: 'inside' }).png(), 'image/png');
  const pngPalette = await render(11, (im) => im.resize(300, 300, { fit: 'inside' }).png({ palette: true, colors: 64, dither: true }), 'image/png');

  // 9 — quality
  const qLow = await render(6, (im) => im.resize(300, 300, { fit: 'inside' }).jpeg({ quality: 20 }), 'image/jpeg');
  const qHigh = await render(6, (im) => im.resize(300, 300, { fit: 'inside' }).jpeg({ quality: 85 }), 'image/jpeg');

  // 10 — ThumbHash placeholder (returns a data URL directly)
  const placeholder = await (await image(8)).placeholder();

  // 11 — progressive JPEG
  const progressive = await render(10, (im) => im.resize(300, 300, { fit: 'inside' }).jpeg({ progressive: true }), 'image/jpeg');

  const sources = await loadSources([
    { label: 'ImagePipelineDemo.svelte', path: './src/demos/image-pipeline/ImagePipelineDemo.svelte' },
    { label: 'routes.ts', path: './src/demos/image-pipeline/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);
</script>

<DemoPage
  title="Image Pipeline"
  description="Every Bun.Image option in one place — decode, resize, rotate, flip, modulate, and re-encode with the raw native pipeline. Each transform runs server-side at request time and is inlined as a data: URL, so the page ships zero client JS."
  {sources}
>
  <h3>Metadata</h3>
  <p><code>.metadata()</code> reads dimensions and format from the header without decoding pixels:</p>
  <div class="row">
    <div class="cell">
      <img src={metaImg} alt="Source photo" />
      <span class="cap"><code>{meta.width} × {meta.height}</code> · <code>{meta.format}</code></span>
    </div>
  </div>

  <h3>Resize · fit</h3>
  <p>The same source into a 240×240 box. <code>fit: 'fill'</code> stretches to the exact box; <code>fit: 'inside'</code> preserves aspect ratio and fits within it:</p>
  <div class="row">
    <div class="cell"><img src={fitFill} alt="fit fill" /><span class="cap"><code>fit: 'fill'</code></span></div>
    <div class="cell"><img src={fitInside} alt="fit inside" /><span class="cap"><code>fit: 'inside'</code></span></div>
  </div>

  <h3>Resample filter</h3>
  <p>
    <code>filter</code> picks the resampling kernel. To make it visible, each image is shrunk to 56px then enlarged to 240px — <code>'nearest'</code> keeps hard pixels, the default
    <code>'lanczos3'</code> interpolates smoothly:
  </p>
  <div class="row">
    <div class="cell"><img src={filterNearest} alt="nearest filter" /><span class="cap"><code>filter: 'nearest'</code></span></div>
    <div class="cell"><img src={filterLanczos} alt="lanczos3 filter" /><span class="cap"><code>filter: 'lanczos3'</code></span></div>
  </div>

  <h3>Rotate</h3>
  <p><code>.rotate(deg)</code> turns the image clockwise in multiples of 90:</p>
  <div class="row">
    <div class="cell"><img src={rotate90} alt="rotated 90 degrees" /><span class="cap"><code>rotate(90)</code></span></div>
    <div class="cell"><img src={rotate180} alt="rotated 180 degrees" /><span class="cap"><code>rotate(180)</code></span></div>
    <div class="cell"><img src={rotate270} alt="rotated 270 degrees" /><span class="cap"><code>rotate(270)</code></span></div>
  </div>

  <h3>Flip · flop</h3>
  <p><code>.flip()</code> mirrors vertically (about the x-axis); <code>.flop()</code> mirrors horizontally:</p>
  <div class="row">
    <div class="cell"><img src={flipOriginal} alt="original" /><span class="cap">original</span></div>
    <div class="cell"><img src={flipped} alt="flipped" /><span class="cap"><code>flip()</code></span></div>
    <div class="cell"><img src={flopped} alt="flopped" /><span class="cap"><code>flop()</code></span></div>
  </div>

  <h3>Modulate</h3>
  <p><code>.modulate()</code> adjusts brightness and saturation (<code>1</code> = unchanged):</p>
  <div class="row">
    <div class="cell"><img src={modGrey} alt="greyscale" /><span class="cap"><code>saturation: 0</code></span></div>
    <div class="cell"><img src={modBright} alt="brightened" /><span class="cap"><code>brightness: 1.5</code></span></div>
    <div class="cell"><img src={modSaturate} alt="saturated" /><span class="cap"><code>saturation: 2</code></span></div>
  </div>

  <h3>Output formats</h3>
  <p>The same 300px image encoded five ways. AVIF and HEIC use the OS backend, so they fall back where the platform can't encode them:</p>
  <div class="row">
    {#each formats as { label, out } (label)}
      <div class="cell">
        {#if out}
          <img src={out.url} alt={label} />
          <span class="cap"><code>{label}</code> · {kb(out.size)}</span>
        {:else}
          <div class="missing">unsupported<br />on this platform</div>
          <span class="cap"><code>{label}</code></span>
        {/if}
      </div>
    {/each}
  </div>

  <h3>Indexed-palette PNG</h3>
  <p><code>png({'{'} palette: true })</code> quantizes to a ≤256-colour indexed PNG — typically several times smaller than truecolor:</p>
  <div class="row">
    <div class="cell"><img src={pngTruecolor.url} alt="truecolor png" /><span class="cap">truecolor · {kb(pngTruecolor.size)}</span></div>
    <div class="cell">
      <img src={pngPalette.url} alt="palette png" />
      <span class="cap"><code>palette: true, colors: 64, dither: true</code> · {kb(pngPalette.size)}</span>
    </div>
  </div>

  <h3>Quality</h3>
  <p>The same JPEG at two quality levels — the trade-off between artefacts and bytes:</p>
  <div class="row">
    <div class="cell"><img src={qLow.url} alt="low quality jpeg" /><span class="cap"><code>quality: 20</code> · {kb(qLow.size)}</span></div>
    <div class="cell"><img src={qHigh.url} alt="high quality jpeg" /><span class="cap"><code>quality: 85</code> · {kb(qHigh.size)}</span></div>
  </div>

  <h3>Placeholder</h3>
  <p>
    <code>.placeholder()</code> returns a ThumbHash-rendered blur as a <code>data:</code> URL (~400–700 bytes, no client decoder) — inline it as an instant low-quality preview before
    the real image loads:
  </p>
  <div class="row">
    <div class="cell"><img class="placeholder" src={placeholder} alt="ThumbHash blur placeholder" /><span class="cap"><code>placeholder()</code></span></div>
  </div>

  <h3>Progressive JPEG</h3>
  <p>
    <code>jpeg({'{'} progressive: true })</code> encodes a progressive JPEG that paints coarse-to-fine as it downloads — visually identical once loaded, but it appears sooner over a
    slow connection:
  </p>
  <div class="row">
    <div class="cell"><img src={progressive.url} alt="progressive jpeg" /><span class="cap"><code>progressive: true</code> · {kb(progressive.size)}</span></div>
  </div>

  <p class="credit">Photos from Unsplash, served from the Mochi demo CDN.</p>
</DemoPage>

<style>
  h3 {
    margin-top: 1.75rem;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    justify-content: center;
    margin: 1rem 0;
  }
  .cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
  }
  .cell img {
    max-width: 100%;
    max-height: 280px;
    width: auto;
    height: auto;
    display: block;
    border-radius: var(--radius-md);
  }
  .cell img.placeholder {
    width: 200px;
    aspect-ratio: 2 / 3;
  }
  .cap {
    font-size: 0.8rem;
    color: var(--text-muted, #888);
    text-align: center;
  }
  .cap code {
    font-size: 0.78rem;
  }
  .missing {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 200px;
    height: 200px;
    text-align: center;
    font-size: 0.8rem;
    color: var(--text-muted, #888);
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .credit {
    margin-top: 2rem;
    font-size: 0.8rem;
    color: var(--text-muted, #888);
  }
</style>
