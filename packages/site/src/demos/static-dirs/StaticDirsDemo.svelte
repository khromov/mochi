<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import CodeSnippet from '../../components/CodeSnippet.svelte';
  import ImageCredits from '../../components/ImageCredits.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { highlightCode } from '../../lib/highlight.server';
  import { files } from './files.ts';

  const photos = [1, 2, 3, 6, 9, 13];

  const config = await highlightCode(
    [
      '// One Bun directory route serves the whole tree — no per-file registration.',
      'await Mochi.serve({',
      "  staticDirs: { '/gallery': './images' },",
      '  routes,',
      '});',
      '',
      '// GET /gallery/mochi-1.jpg  ->  packages/site/images/mochi-1.jpg',
      '//   served byte-for-byte, with Content-Type / ETag / Range / 304 from Bun.',
    ].join('\n'),
    'typescript',
  );

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Static Directories"
  description="staticDirs mounts a whole directory tree under a URL prefix as a single Bun directory route. Every file inside is served straight from disk — Content-Type, ETag, conditional 304s, Range requests and index.html all come from Bun, with no per-file route registration."
  {sources}
>
  <p>
    The gallery below is the site's <code>images/</code> folder, mounted at <code>/gallery</code>. Each
    <code>&lt;img&gt;</code> points straight at the file on disk — a plain path, no query string, no signing, unlike the transformed
    <a href="/demos/image-pipeline/">image pipeline</a>.
  </p>
  <CodeSnippet html={config} />

  <div class="grid">
    {#each photos as n (n)}
      <figure>
        <img src="/gallery/mochi-{n}.jpg" alt="Mochi photo {n}" loading="lazy" />
        <figcaption><code>/gallery/mochi-{n}.jpg</code></figcaption>
      </figure>
    {/each}
  </div>

  <h3>When to reach for it</h3>
  <p>
    <code>staticDirs</code> is one route per mount, so it stays cheap for large or generated trees — a media library, a docs export, another tool's build directory. It serves
    dotfiles and returns Bun's bare 404 on a miss. For ordinary site assets keep using <code>publicDir</code>, which registers one route per file, skips dotfiles, and falls through
    to your error page.
  </p>

  <ImageCredits />
</DemoPage>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 1rem;
    margin: 1rem 0;
  }
  figure {
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
  }
  figure img {
    width: 100%;
    aspect-ratio: 3 / 2;
    object-fit: cover;
    display: block;
    border-radius: var(--radius-md);
  }
  figcaption {
    font-size: 0.78rem;
    color: var(--text-muted, #888);
  }
  h3 {
    margin-top: 1.75rem;
  }
</style>
