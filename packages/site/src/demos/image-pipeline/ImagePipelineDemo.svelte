<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import CodeSnippet from '../../components/CodeSnippet.svelte';
  import ImageCredits from '../../components/ImageCredits.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { highlightCode } from '../../lib/highlight.server';

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

  async function du(n, build, mime = 'image/webp') {
    return (await render(n, build, mime)).url;
  }

  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
  const snippet = (code) => highlightCode(code, 'typescript');

  // 0 — how `img` is set up; every example below reuses it
  const codeSetup = await snippet(
    [
      '// fetch the bytes, then decode — Bun.Image takes a path, Buffer, or Blob',
      "const url = 'https://sta-public.fra1.cdn.digitaloceanspaces.com/mochi/mochi-1.jpg';",
      'const bytes = await fetch(url).then((r) => r.bytes());',
      'const img = new Bun.Image(bytes);',
    ].join('\n'),
  );

  // 1 — metadata (no pixels decoded)
  const meta = await (await image(1)).metadata();
  const metaImg = await du(1, (im) => im.resize(260, 260, { fit: 'inside' }).webp());
  const codeMeta = await snippet('await img.metadata();\n// { width, height, format }');

  // 2 — fit
  const fitFill = await du(2, (im) => im.resize(240, 240, { fit: 'fill' }).webp());
  const fitInside = await du(2, (im) => im.resize(240, 240, { fit: 'inside' }).webp());
  const codeFit = await snippet("img.resize(240, 240, { fit: 'inside' });");

  // 3 — resample filter (downscale then upscale to make the kernel visible)
  const filterNearest = await du(3, (im) => im.resize(56, 56, { fit: 'inside' }).resize(240, 240, { fit: 'fill', filter: 'nearest' }).webp());
  const filterLanczos = await du(3, (im) => im.resize(56, 56, { fit: 'inside' }).resize(240, 240, { fit: 'fill', filter: 'lanczos3' }).webp());
  const codeFilter = await snippet("img.resize(240, 240, { filter: 'nearest' });");

  // 4 — rotate
  const rotate90 = await du(4, (im) => im.resize(200, 200, { fit: 'inside' }).rotate(90).webp());
  const rotate180 = await du(4, (im) => im.resize(200, 200, { fit: 'inside' }).rotate(180).webp());
  const rotate270 = await du(4, (im) => im.resize(200, 200, { fit: 'inside' }).rotate(270).webp());
  const codeRotate = await snippet('img.rotate(90);');

  // 5 — flip / flop
  const flipOriginal = await du(5, (im) => im.resize(200, 200, { fit: 'inside' }).webp());
  const flipped = await du(5, (im) => im.resize(200, 200, { fit: 'inside' }).flip().webp());
  const flopped = await du(5, (im) => im.resize(200, 200, { fit: 'inside' }).flop().webp());
  const codeFlip = await snippet('img.flip(); // or img.flop()');

  // 6 — modulate
  const modGrey = await du(7, (im) => im.resize(200, 200, { fit: 'inside' }).modulate({ saturation: 0 }).webp());
  const modBright = await du(7, (im) => im.resize(200, 200, { fit: 'inside' }).modulate({ brightness: 1.5 }).webp());
  const modSaturate = await du(7, (im) => im.resize(200, 200, { fit: 'inside' }).modulate({ saturation: 2 }).webp());
  const codeModulate = await snippet('img.modulate({ saturation: 0 });');

  // 7 — output formats + size, same source/size for a fair comparison
  const FMT_SRC = 9;
  const fmt = (build, mime) => render(FMT_SRC, (im) => build(im.resize(300, 300, { fit: 'inside' })), mime);
  const formats = [
    { label: 'jpeg({ quality: 85 })', out: await fmt((im) => im.jpeg({ quality: 85 }), 'image/jpeg') },
    { label: 'png()', out: await fmt((im) => im.png(), 'image/png') },
    { label: 'webp({ quality: 80 })', out: await fmt((im) => im.webp({ quality: 80 }), 'image/webp') },
  ];
  const codeFormat = await snippet('img.webp({ quality: 80 });');

  // 8 — indexed-palette PNG
  const pngTruecolor = await render(11, (im) => im.resize(300, 300, { fit: 'inside' }).png(), 'image/png');
  const pngPalette = await render(11, (im) => im.resize(300, 300, { fit: 'inside' }).png({ palette: true, colors: 32, dither: true }), 'image/png');
  const codePalette = await snippet('img.png({ palette: true, colors: 32, dither: true });');

  // 9 — quality
  const qLow = await render(6, (im) => im.resize(300, 300, { fit: 'inside' }).jpeg({ quality: 20 }), 'image/jpeg');
  const qHigh = await render(6, (im) => im.resize(300, 300, { fit: 'inside' }).jpeg({ quality: 85 }), 'image/jpeg');
  const codeQuality = await snippet('img.jpeg({ quality: 20 });');

  // 10 — ThumbHash placeholder (returns a data URL directly)
  const PH_SRC = 8;
  const phMeta = await (await image(PH_SRC)).metadata();
  const phRatio = `${phMeta.width} / ${phMeta.height}`;
  const placeholder = await (await image(PH_SRC)).placeholder();
  const placeholderReal = await du(PH_SRC, (im) => im.resize(200, 200, { fit: 'inside' }).webp());
  const codePlaceholder = await snippet('await img.placeholder();\n// "data:image/png;base64,..."');

  // 11 — progressive JPEG
  const progressive = await render(10, (im) => im.resize(300, 300, { fit: 'inside' }).jpeg({ progressive: true }), 'image/jpeg');
  const codeProgressive = await snippet('img.jpeg({ progressive: true });');

  const sources = await loadSources([
    { label: 'ImagePipelineDemo.svelte', path: './src/demos/image-pipeline/ImagePipelineDemo.svelte' },
    { label: 'routes.ts', path: './src/demos/image-pipeline/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);
</script>

<DemoPage
  title="Advanced Image use"
  description="Every Bun.Image option in one place — decode, resize, rotate, flip, modulate, and re-encode with the raw native pipeline. Each transform runs server-side at request time and is inlined as a data: URL, so the page ships zero client JS."
  {sources}
>
  <p>
    Each example starts from a single decoded source. We fetch one of the demo photos from the CDN and decode the bytes — every snippet below reuses this <code>img</code>. (Pass
    downloaded bytes, not a URL: <code>Bun.Image</code> treats a string as a filesystem path, so handing it untrusted input is an arbitrary-file-read.)
  </p>
  <CodeSnippet html={codeSetup} />

  <h3>Metadata</h3>
  <p><code>.metadata()</code> reads dimensions and format from the header without decoding pixels:</p>
  <CodeSnippet html={codeMeta} />
  <div class="row">
    <div class="cell">
      <img src={metaImg} alt="Source photo" />
      <span class="cap"><code>{meta.width} × {meta.height}</code> · <code>{meta.format}</code></span>
    </div>
  </div>

  <h3>Resize · fit</h3>
  <p>The same source into a 240×240 box. <code>fit: 'fill'</code> stretches to the exact box; <code>fit: 'inside'</code> preserves aspect ratio and fits within it:</p>
  <CodeSnippet html={codeFit} />
  <div class="row">
    <div class="cell"><img src={fitFill} alt="fit fill" /><span class="cap"><code>fit: 'fill'</code></span></div>
    <div class="cell"><img src={fitInside} alt="fit inside" /><span class="cap"><code>fit: 'inside'</code></span></div>
  </div>

  <h3>Resample filter</h3>
  <p>
    <code>filter</code> picks the resampling kernel. To make it visible, each image is shrunk to 56px then enlarged to 240px — <code>'nearest'</code> keeps hard pixels, the default
    <code>'lanczos3'</code> interpolates smoothly:
  </p>
  <CodeSnippet html={codeFilter} />
  <div class="row">
    <div class="cell"><img src={filterNearest} alt="nearest filter" /><span class="cap"><code>filter: 'nearest'</code></span></div>
    <div class="cell"><img src={filterLanczos} alt="lanczos3 filter" /><span class="cap"><code>filter: 'lanczos3'</code></span></div>
  </div>

  <h3>Rotate</h3>
  <p><code>.rotate(deg)</code> turns the image clockwise in multiples of 90:</p>
  <CodeSnippet html={codeRotate} />
  <div class="row">
    <div class="cell"><img src={rotate90} alt="rotated 90 degrees" /><span class="cap"><code>rotate(90)</code></span></div>
    <div class="cell"><img src={rotate180} alt="rotated 180 degrees" /><span class="cap"><code>rotate(180)</code></span></div>
    <div class="cell"><img src={rotate270} alt="rotated 270 degrees" /><span class="cap"><code>rotate(270)</code></span></div>
  </div>

  <h3>Flip · flop</h3>
  <p><code>.flip()</code> mirrors vertically (about the x-axis); <code>.flop()</code> mirrors horizontally:</p>
  <CodeSnippet html={codeFlip} />
  <div class="row">
    <div class="cell"><img src={flipOriginal} alt="original" /><span class="cap">original</span></div>
    <div class="cell"><img src={flipped} alt="flipped" /><span class="cap"><code>flip()</code></span></div>
    <div class="cell"><img src={flopped} alt="flopped" /><span class="cap"><code>flop()</code></span></div>
  </div>

  <h3>Modulate</h3>
  <p><code>.modulate()</code> adjusts brightness and saturation (<code>1</code> = unchanged):</p>
  <CodeSnippet html={codeModulate} />
  <div class="row">
    <div class="cell"><img src={modGrey} alt="greyscale" /><span class="cap"><code>saturation: 0</code></span></div>
    <div class="cell"><img src={modBright} alt="brightened" /><span class="cap"><code>brightness: 1.5</code></span></div>
    <div class="cell"><img src={modSaturate} alt="saturated" /><span class="cap"><code>saturation: 2</code></span></div>
  </div>

  <h3>Output formats</h3>
  <p>
    The same 300px image encoded three ways, with byte sizes. <code>Bun.Image</code> can also encode <code>avif()</code> and <code>heic()</code>, but those go through the OS
    backend and are only available on macOS and Windows:
  </p>
  <CodeSnippet html={codeFormat} />
  <div class="row">
    {#each formats as { label, out } (label)}
      <div class="cell">
        <img src={out.url} alt={label} />
        <span class="cap"><code>{label}</code> · {kb(out.size)}</span>
      </div>
    {/each}
  </div>

  <h3>Indexed-palette PNG</h3>
  <p><code>png({'{'} palette: true })</code> quantizes to a ≤256-colour indexed PNG — typically several times smaller than truecolor:</p>
  <CodeSnippet html={codePalette} />
  <div class="row">
    <div class="cell"><img src={pngTruecolor.url} alt="truecolor png" /><span class="cap">truecolor · {kb(pngTruecolor.size)}</span></div>
    <div class="cell">
      <img src={pngPalette.url} alt="palette png" />
      <span class="cap"><code>palette: true, colors: 32, dither: true</code> · {kb(pngPalette.size)}</span>
    </div>
  </div>

  <h3>Quality</h3>
  <p>The same JPEG at two quality levels — the trade-off between artefacts and bytes:</p>
  <CodeSnippet html={codeQuality} />
  <div class="row">
    <div class="cell"><img src={qLow.url} alt="low quality jpeg" /><span class="cap"><code>quality: 20</code> · {kb(qLow.size)}</span></div>
    <div class="cell"><img src={qHigh.url} alt="high quality jpeg" /><span class="cap"><code>quality: 85</code> · {kb(qHigh.size)}</span></div>
  </div>

  <h3>Placeholder</h3>
  <p>
    <code>.placeholder()</code> returns a ThumbHash-rendered blur as a <code>data:</code> URL (~400–700 bytes, no client decoder) — inline it as an instant low-quality preview before
    the real image loads:
  </p>
  <CodeSnippet html={codePlaceholder} />
  <div class="row">
    <div class="cell">
      <img class="placeholder" style:aspect-ratio={phRatio} src={placeholder} alt="ThumbHash blur placeholder" /><span class="cap"><code>placeholder()</code></span>
    </div>
    <div class="cell"><img class="placeholder" src={placeholderReal} alt="The full-resolution image" /><span class="cap">full image</span></div>
  </div>

  <h3>Progressive JPEG</h3>
  <p>
    <code>jpeg({'{'} progressive: true })</code> encodes a progressive JPEG that paints coarse-to-fine as it downloads — visually identical once loaded, but it appears sooner over a
    slow connection:
  </p>
  <CodeSnippet html={codeProgressive} />
  <div class="row">
    <div class="cell"><img src={progressive.url} alt="progressive jpeg" /><span class="cap"><code>progressive: true</code> · {kb(progressive.size)}</span></div>
  </div>

  <ImageCredits />
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
    height: auto;
  }
  .cap {
    font-size: 0.8rem;
    color: var(--text-muted, #888);
    text-align: center;
  }
  .cap code {
    font-size: 0.78rem;
  }
</style>
