<script lang="ts">
  import { url } from 'mochi-framework';
  import { ViewTransitions } from 'mochi-framework/components';
  import DemoPage from '../../components/DemoPage.svelte';
  import SpinCard from './SpinCard.svelte';
  import { description, sources, parseSpin } from './shared';

  const spin = parseSpin(url.searchParams.get('spin'));
</script>

<DemoPage title="Custom Transitions" {description} {sources}>
  <ViewTransitions custom={{ out: spin.out, in: spin.in }} easing={spin.easing} duration={600} regions="card" />
  <SpinCard page={1} {spin} />
</DemoPage>
