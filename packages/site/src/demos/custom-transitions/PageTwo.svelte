<script lang="ts">
  import { ViewTransitions } from 'mochi-framework/components';
  import DemoPage from '../../components/DemoPage.svelte';
  import SpinCard from './SpinCard.svelte';
  import { description, sources } from './shared';
</script>

<DemoPage title="Custom Transitions" {description} {sources}>
  <ViewTransitions
    custom={{
      out: 'to { transform: rotate(540deg) scale(0); opacity: 0 }',
      in: 'from { transform: rotate(-540deg) scale(0); opacity: 0 }',
    }}
    easing="cubic-bezier(0.68, -0.55, 0.27, 1.55)"
    duration={600}
    regions="card"
  />
  <SpinCard page={2} />
</DemoPage>
