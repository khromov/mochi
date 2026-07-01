<script lang="ts">
  import { url } from 'mochi-framework';
  import { ViewTransitions } from 'mochi-framework/components';
  import DemoPage from '../../components/DemoPage.svelte';
  import TransitionCard from './TransitionCard.svelte';
  import { description, sources, parseTransition } from './shared';

  const type = parseTransition(url.searchParams.get('type'));
</script>

<DemoPage title="View Transitions" {description} {sources}>
  <ViewTransitions {type} regions="card" />
  <TransitionCard page={1} {type} />
</DemoPage>
