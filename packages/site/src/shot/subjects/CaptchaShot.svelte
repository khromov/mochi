<script lang="ts">
  import { MochiCaptcha } from 'mochi-framework/components';
  import { themes } from '../../demos/captcha-styling/themes.ts';
  import type { ThemeName } from '../../demos/captcha-styling/themes.ts';
  import type { MintedCaptcha } from 'mochi-framework';

  let { captcha, theme }: { captcha: MintedCaptcha; theme: ThemeName | 'defaults' } = $props();

  // 'defaults' deliberately applies nothing: the widget's var() fallbacks are the subject.
  const applied = $derived(theme === 'defaults' ? null : themes[theme]);
</script>

<!-- Hydrated by the whole-subtree island in Shot.svelte, so MochiCaptcha needs no
     directive of its own — and couldn't carry one anyway, being a package import. -->
<div class="subject" style={applied?.css}>
  <MochiCaptcha {...captcha} emoji={applied?.emoji} label={applied?.label} />
</div>

<style>
  /* The track fills its container, so the frame has to give it a width to fill. */
  .subject {
    width: 26rem;
  }
</style>
