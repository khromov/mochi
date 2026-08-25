<script lang="ts">
  import { getRequestContext } from 'mochi-framework';
  import DemoPage from '../../components/DemoPage.svelte';
  import I18nForm from './I18nForm.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const { locals } = getRequestContext();
  const locale = (locals.locale as string) ?? 'en';
  const sources = await loadSources(files);
</script>

<DemoPage
  title="Internationalization (cookies)"
  description="A cookie holds the visitor's language. Mochi reads it during SSR so the page renders translated, and the hydrated island switches language in place — then writes the cookie so the choice sticks on the next request."
  {sources}
>
  <I18nForm initialLocale={locale} mochi:hydrate />
</DemoPage>
