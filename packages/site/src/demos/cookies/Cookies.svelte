<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import CookieDemo from './CookieDemo.svelte';
  import { loadSources } from '../../components/utils.ts';

  const cuteNames = ['mochi_fan', 'bun_bun', 'pixel_panda', 'tiny_tanuki', 'cloud_kitten', 'waffle_fox', 'cocoa_bear', 'starry_otter', 'maple_duck', 'peach_pup'];
  const randomCuteName = cuteNames[Math.floor(Math.random() * cuteNames.length)];

  const sources = await loadSources([
    { label: 'Cookies.svelte', path: './src/demos/cookies/Cookies.svelte' },
    { label: 'CookieDemo.svelte', path: './src/demos/cookies/CookieDemo.svelte' },
    { label: 'routes.ts', path: './src/demos/cookies/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);
</script>

<DemoPage
  title="Cookies"
  description="You can read incoming cookies during SSR and write them back via Set-Cookie through the Mochi cookies API exposed on both server and client."
  {sources}
>
  <CookieDemo defaultUsername={randomCuteName} mochi:hydrate />
</DemoPage>
