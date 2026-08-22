<script module>
  import { compiled, getImageUrl, getImage } from 'mochi-framework';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';
  import { highlightCode } from '../../lib/highlight.server';

  const CDN = 'https://sta-public.fra1.cdn.digitaloceanspaces.com/mochi';
  const srcUrl = (n) => `${CDN}/mochi-${n}.jpg`;

  const snippet = (code) => highlightCode(code, 'typescript');

  // Every URL + snippet below is request-independent, so compute the whole page once and cache the result.
  async function computePage() {
    const codeSetup = await snippet(
      [
        "import { getImageUrl, getImage } from 'mochi-framework';",
        '',
        '// Sizes are declared once in Mochi.serve({ image: { sizes } }).',
        '// getImageUrl mints a signed URL; the transform runs in the endpoint.',
        "const url = getImageUrl(src, 'thumb'); // near-instant, for <img src>",
        '',
        '// getImage runs the size inline and returns bytes + metadata.',
        "const { bytes, width, height, format } = await getImage(src, 'thumb');",
      ].join('\n'),
    );

    const metaImg = getImageUrl(srcUrl(1), 'thumb');
    const meta = await getImage(srcUrl(1), 'thumb');
    const codeMeta = await snippet("await getImage(src, 'thumb');\n// { bytes, width, height, format }");

    const fitFill = getImageUrl(srcUrl(2), 'fit-fill');
    const fitInside = getImageUrl(srcUrl(2), 'fit-inside');
    const codeFit = await snippet("getImageUrl(src, 'fit-inside');");

    const rotate90 = getImageUrl(srcUrl(4), 'rotate90');
    const rotate180 = getImageUrl(srcUrl(4), 'rotate180');
    const rotate270 = getImageUrl(srcUrl(4), 'rotate270');
    const codeRotate = await snippet("// sizes: { rotate90: { rotate: 90, … } }\ngetImageUrl(src, 'rotate90');");

    const flipOriginal = getImageUrl(srcUrl(5), 'fit-inside');
    const flipped = getImageUrl(srcUrl(5), 'flip');
    const flopped = getImageUrl(srcUrl(5), 'flop');
    const codeFlip = await snippet("// { flip: true } or { flop: true }\ngetImageUrl(src, 'flip');");

    const modGrey = getImageUrl(srcUrl(7), 'grayscale');
    const modBright = getImageUrl(srcUrl(7), 'brighten');
    const modSaturate = getImageUrl(srcUrl(7), 'saturate');
    const codeModulate = await snippet("// { modulate: { saturation: 0 } }\ngetImageUrl(src, 'grayscale');");

    // getImage runs each inline so we can report the encoded byte size; same source + size for a fair comparison.
    const FMT_SRC = 9;
    const fmtDefs = [
      { label: 'fmt-jpeg (q85)', name: 'fmt-jpeg' },
      { label: 'fmt-png', name: 'fmt-png' },
      { label: 'fmt-webp (q80)', name: 'fmt-webp' },
    ];
    const formats = await Promise.all(
      fmtDefs.map(async (d) => ({ label: d.label, url: getImageUrl(srcUrl(FMT_SRC), d.name), size: (await getImage(srcUrl(FMT_SRC), d.name)).bytes.length })),
    );
    const codeFormat = await snippet("const { bytes } = await getImage(src, 'fmt-webp');");

    const sources = await compiled(() => loadSources(files));

    return {
      codeSetup,
      metaImg,
      meta,
      codeMeta,
      fitFill,
      fitInside,
      codeFit,
      rotate90,
      rotate180,
      rotate270,
      codeRotate,
      flipOriginal,
      flipped,
      flopped,
      codeFlip,
      modGrey,
      modBright,
      modSaturate,
      codeModulate,
      formats,
      codeFormat,
      sources,
    };
  }

  // In-process layer: assemble the page (incl. syntax highlighting) once per
  // process; the image cache is the persistent, cross-restart layer underneath.
  let built;
  export function buildPage() {
    return (built ??= computePage());
  }
</script>

<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import CodeSnippet from '../../components/CodeSnippet.svelte';
  import ImageCredits from '../../components/ImageCredits.svelte';

  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

  const {
    codeSetup,
    metaImg,
    meta,
    codeMeta,
    fitFill,
    fitInside,
    codeFit,
    rotate90,
    rotate180,
    rotate270,
    codeRotate,
    flipOriginal,
    flipped,
    flopped,
    codeFlip,
    modGrey,
    modBright,
    modSaturate,
    codeModulate,
    formats,
    codeFormat,
    sources,
  } = await buildPage();
</script>

<DemoPage
  title="Image: Named sizes"
  description="Transforms are declared once as named sizes under image.sizes in Mochi.serve() and referenced by name. getImageUrl(src, name) mints a signed URL and the /_mochi/image endpoint runs the size lazily — so SSR never blocks. getImage(src, name) is the inline escape hatch that returns the transformed bytes + metadata, used below for dimensions and byte sizes."
  {sources}
>
  <p>
    Each example references a size by name. <code>getImageUrl</code> is synchronous — it only signs a URL; the fetch, decode, and transform happen in the endpoint on the browser's
    request, cached on disk so later requests skip the work. <code>getImage</code> runs the same size inline when you need the bytes server-side.
  </p>
  <CodeSnippet html={codeSetup} />

  <h3>Metadata</h3>
  <p><code>getImage()</code> returns the transformed bytes plus dimensions and format:</p>
  <CodeSnippet html={codeMeta} />
  <div class="row">
    <div class="cell">
      <img src={metaImg} alt="Rendered via the thumb size" />
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

  <h3>Rotate</h3>
  <p>A size's <code>rotate</code> turns the image clockwise in multiples of 90:</p>
  <CodeSnippet html={codeRotate} />
  <div class="row">
    <div class="cell"><img src={rotate90} alt="rotated 90 degrees" /><span class="cap"><code>rotate: 90</code></span></div>
    <div class="cell"><img src={rotate180} alt="rotated 180 degrees" /><span class="cap"><code>rotate: 180</code></span></div>
    <div class="cell"><img src={rotate270} alt="rotated 270 degrees" /><span class="cap"><code>rotate: 270</code></span></div>
  </div>

  <h3>Flip · flop</h3>
  <p><code>flip: true</code> mirrors vertically (about the x-axis); <code>flop: true</code> mirrors horizontally:</p>
  <CodeSnippet html={codeFlip} />
  <div class="row">
    <div class="cell"><img src={flipOriginal} alt="original" /><span class="cap">original</span></div>
    <div class="cell"><img src={flipped} alt="flipped" /><span class="cap"><code>flip</code></span></div>
    <div class="cell"><img src={flopped} alt="flopped" /><span class="cap"><code>flop</code></span></div>
  </div>

  <h3>Modulate</h3>
  <p>A size's <code>modulate</code> adjusts brightness and saturation (<code>1</code> = unchanged):</p>
  <CodeSnippet html={codeModulate} />
  <div class="row">
    <div class="cell"><img src={modGrey} alt="greyscale" /><span class="cap"><code>saturation: 0</code></span></div>
    <div class="cell"><img src={modBright} alt="brightened" /><span class="cap"><code>brightness: 1.5</code></span></div>
    <div class="cell"><img src={modSaturate} alt="saturated" /><span class="cap"><code>saturation: 2</code></span></div>
  </div>

  <h3>Output formats</h3>
  <p>The same 300px image through three format sizes, with byte sizes from <code>getImage()</code>. <code>Bun.Image</code> can also encode <code>avif</code>:</p>
  <CodeSnippet html={codeFormat} />
  <div class="row">
    {#each formats as { label, url, size } (label)}
      <div class="cell">
        <img src={url} alt={label} />
        <span class="cap"><code>{label}</code> · {kb(size)}</span>
      </div>
    {/each}
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
  .cap {
    font-size: 0.8rem;
    color: var(--text-muted, #888);
    text-align: center;
  }
  .cap code {
    font-size: 0.78rem;
  }
</style>
