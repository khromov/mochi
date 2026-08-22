<script lang="ts">
  import { MochiCaptcha } from 'mochi-framework/components';
  import type { MintedCaptcha } from 'mochi-framework';

  let { captcha }: { captcha: MintedCaptcha } = $props();
</script>

<MochiCaptcha {...captcha} label="Slide to verify" />
