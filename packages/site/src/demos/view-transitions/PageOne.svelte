<script lang="ts">
  import { url } from 'mochi-framework';
  import { ViewTransitions } from 'mochi-framework/components';
  import DemoPage from '../../components/DemoPage.svelte';
  import TransitionCard from './TransitionCard.svelte';
  import { loadSources } from '../../components/utils.ts';

  const type = url.searchParams.get('type') === 'slide' ? 'slide' : 'fade';

  const sources = await loadSources([
    { label: 'PageOne.svelte', path: './src/demos/view-transitions/PageOne.svelte' },
    { label: 'PageTwo.svelte', path: './src/demos/view-transitions/PageTwo.svelte' },
    { label: 'TransitionCard.svelte', path: './src/demos/view-transitions/TransitionCard.svelte' },
    { label: 'routes.ts', path: './src/demos/view-transitions/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);
</script>

<DemoPage
  title="View Transitions"
  description="Add <ViewTransitions /> to a shared layout to animate full-page navigations with zero JavaScript via the browser's cross-document View Transitions API. Click between the two pages to see it."
  {sources}
>
  <ViewTransitions {type} regions="card" />
  <TransitionCard page={1} {type} />
</DemoPage>
