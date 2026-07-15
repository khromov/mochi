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
  /* The track fills its container; the frame sizes that container from the subject's
     declared natural width, so this must not set a width of its own. */
  .subject {
    width: 100%;
  }
</style>
