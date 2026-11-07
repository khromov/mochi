<script lang="ts">
  import Island from './Island.svelte';
  import type { MintedCaptcha } from 'mochi-framework';

  const captcha: MintedCaptcha = { token: 'test-token', bits: 8, solveBudgetMs: 1000 };
</script>

<section>
  <Island mochi:hydrate {captcha} />
</section>
