import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/hn': (req: Request) => Response.redirect(new URL('/hn/front', req.url)),
  '/hn/front': Mochi.page('./src/hn/HNStories.svelte', { serverProps: { type: 'topstories' } }),
  '/hn/new': Mochi.page('./src/hn/HNStories.svelte', { serverProps: { type: 'newstories' } }),
  '/hn/ask': Mochi.page('./src/hn/HNStories.svelte', { serverProps: { type: 'askstories' } }),
  '/hn/show': Mochi.page('./src/hn/HNStories.svelte', { serverProps: { type: 'showstories' } }),
  '/hn/jobs': Mochi.page('./src/hn/HNStories.svelte', { serverProps: { type: 'jobstories' } }),
  '/hn/item/:id': Mochi.page('./src/hn/HNItem.svelte'),
  '/hn/user/:id': Mochi.page('./src/hn/HNUser.svelte'),
};
