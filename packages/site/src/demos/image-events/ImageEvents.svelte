<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import ImageCredits from '../../components/ImageCredits.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';
  import { remote } from './log.ts';
  import { Image } from 'mochi-framework/image';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Image: Events"
  description="The <Image> cache emits image:store when it downloads an original, generates a resized variant, or computes a blur placeholder — and image:delete when a file is evicted, superseded, or invalidated. Subscribe on mochiEvents to mirror the cache to durable storage like S3. This demo logs every event to the server console with a [demo:image-events] prefix — load this page cold and watch your terminal."
  {sources}
>
  <p>
    Rendering this <code>&lt;Image&gt;</code> on a cold cache fetches the original, encodes a resized variant, and computes a ThumbHash placeholder — three
    <code>image:store</code> events, one per file written to disk:
  </p>
  <div class="frame">
    <Image src={remote} size="hero" placeholder alt="A resized random photo" />
  </div>
  <p class="hint">
    Each event carries the on-disk <code>path</code> plus <code>kind</code>, <code>src</code>, <code>size</code>, and (for variants) dimensions/format — everything an S3 mirror
    needs to upload the byte file. <code>image:delete</code> fires later, when the background janitor sweep evicts stale entries or you call
    <code>invalidateImage()</code>.
  </p>

  <ImageCredits />
</DemoPage>

<style>
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
  .hint {
    font-size: 0.85rem;
    color: var(--text-muted, #888);
    margin: 0;
  }
</style>
