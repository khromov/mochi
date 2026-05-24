import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import HNStories from './HNStories.svelte';
import HNItem from './HNItem.svelte';
import HNUser from './HNUser.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/hn': (req: Request) => Response.redirect(new URL('/hn/front', req.url)),
  '/hn/front': Mochi.page(HNStories, { serverProps: { type: 'topstories' } }),
  '/hn/new': Mochi.page(HNStories, { serverProps: { type: 'newstories' } }),
  '/hn/ask': Mochi.page(HNStories, { serverProps: { type: 'askstories' } }),
  '/hn/show': Mochi.page(HNStories, { serverProps: { type: 'showstories' } }),
  '/hn/jobs': Mochi.page(HNStories, { serverProps: { type: 'jobstories' } }),
  '/hn/item/:id': Mochi.page(HNItem),
  '/hn/user/:id': Mochi.page(HNUser),
};
