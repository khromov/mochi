<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import UrlInfo from './UrlInfo.svelte';
  import { compiled } from 'mochi-framework';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await compiled(() => loadSources(files));
</script>

<DemoPage
  title="Isomorphic URL"
  description={"import { url } from 'mochi-framework' returns the current URL on both server and client. On the server it reads from the request context; on the client it reads from window.location. Try adding ?name=mochi to the URL."}
  {sources}
>
  <div class="sections">
    <UrlInfo label="SSR snapshot" />
    <hr />
    <UrlInfo label="Hydrated island" mochi:hydrate />
  </div>
</DemoPage>

<style>
  .sections {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
  }

  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 0;
  }
</style>
