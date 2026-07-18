<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import CodeSnippet from '../../components/CodeSnippet.svelte';
  import ImageCredits from '../../components/ImageCredits.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';
  import { Image } from 'mochi-framework/image';
  import { getImageUrl } from 'mochi-framework';
  import { highlightCode } from '../../lib/highlight.server';

  let { photo, uploaded } = $props();

  const squareUrl = getImageUrl(photo.src, 'square');

  const ts = (code) => highlightCode(code, 'typescript');
  const codeConfig = await ts("localDirs: { photos: './images', uploads: './uploads' },");
  const codeRead = await ts("const photo = await localImage('photos/mochi-3.jpg');\n// photo → { src: '/_mochi/files/photos/mochi-3.jpg', width, height, format }");
  const codeWrite = await ts("await Bun.write('./uploads/mochi-copy.jpg', bytes);\nconst uploaded = await localImage('uploads/mochi-copy.jpg');");
  const codeUrl = await ts("const url = getImageUrl(photo.src, 'square');");

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Image: Filesystem"
  description="Serve images from a runtime read/write folder. localDirs declares allowlisted roots; any image inside one is addressable by path the moment it exists on disk — no build step, no registration, and the path-addressed URLs survive restarts."
  {sources}
>
  <h3>Declare the folders</h3>
  <p>
    Build-time imports (<code>import hero from './hero.jpg'</code>) bake the file into the build. A <code>localDirs</code> folder is the runtime counterpart: whatever is in the
    folder <em>right now</em> is servable, so app code can write images while the server runs:
  </p>
  <CodeSnippet html={codeConfig} />

  <h3>Read a file from a folder</h3>
  <p>
    <code>localImage('&lt;dir&gt;/&lt;path&gt;')</code> probes the file and returns the same <code>{'{ src, width, height, format }'}</code> shape as a build-time import — pass it
    straight to <code>&lt;Image&gt;</code>:
  </p>
  <CodeSnippet html={codeRead} />
  <div class="frame">
    <Image src={photo} size="hero" alt="A photo served from the ./images folder" />
  </div>
  <p class="note">Served from <code>{photo.src}</code> — {photo.width}&times;{photo.height} {photo.format}.</p>

  <h3>Write raw bytes at runtime</h3>
  <p>
    This page's <code>serverProps</code> wrote raw bytes into <code>./uploads/</code> with <code>Bun.write</code>, then read the new file back — no restart, no registration step.
    That's the whole upload flow:
  </p>
  <CodeSnippet html={codeWrite} />
  <div class="frame">
    <Image src={uploaded} size="square" alt="A photo written into ./uploads at runtime" />
  </div>
  <p class="note">Served from <code>{uploaded.src}</code>.</p>

  <h3>Transforms</h3>
  <p><code>getImageUrl</code> works on a local-dir <code>src</code> exactly as on a remote URL — the endpoint reads the bytes from disk, no network fetch:</p>
  <pre class="url">{squareUrl}</pre>
  <div class="frame">
    <img src={squareUrl} width="400" alt="Local-dir photo resized via getImageUrl()" />
  </div>
  <CodeSnippet html={codeUrl} />

  <ImageCredits />
</DemoPage>

<style>
  h3 {
    margin-top: 1.5rem;
  }
  .frame {
    display: flex;
    justify-content: center;
    margin: 1rem 0;
  }
  .frame :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-md);
  }
  /* The global `pre` style supplies the dark code background/text; only the
     size differs here. */
  .url {
    font-size: 0.8rem;
  }
  .note {
    margin-top: 0.5rem;
    font-size: 0.85rem;
    color: var(--text-muted, #888);
  }
</style>
