<script lang="ts">
  import { url } from 'mochi-framework';
  import { ViewTransitions } from 'mochi-framework/components';
  import DemoPage from '../../components/DemoPage.svelte';
  import TransitionCard from './TransitionCard.svelte';
  import { description, sources } from './shared';

  const type = url.searchParams.get('type') === 'slide' ? 'slide' : 'fade';
</script>

<DemoPage title="View Transitions" {description} {sources}>
  <ViewTransitions {type} regions="card" />
  <TransitionCard page={2} {type} />
</DemoPage>
