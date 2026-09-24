import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { buildDocsNav, loadDocs } from '../lib/docs';

const serverProps = async () => {
  const docs = await loadDocs();
  return {
    docsNav: await buildDocsNav(),
    firstDocSlug: docs[0]?.slug ?? 'intro',
  };
};

export const routes: Record<string, MochiRouteValue> = {
  '/front-1': Mochi.page('./src/front/front-1/Front1.svelte', { serverProps }),
  '/front-2': Mochi.page('./src/front/front-2/Front2.svelte', { serverProps }),
  '/front-3': Mochi.page('./src/front/front-3/Front3.svelte', { serverProps }),
  '/front-4': Mochi.page('./src/front/front-4/Front4.svelte', { serverProps }),
};
