import { Mochi, getRequestContext } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

const FRUITS = ['apple', 'apricot', 'banana', 'blueberry', 'cherry', 'grape', 'lemon', 'mango', 'orange', 'peach', 'pear', 'plum'];

export const routes: Record<string, MochiRouteValue> = {
  '/demos/runed': Mochi.page('./src/demos/runed/Runed.svelte'),
  '/api/runed/search': Mochi.api(() => {
    const { url } = getRequestContext();
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const matches = q ? FRUITS.filter((f) => f.includes(q)) : FRUITS;
    return Response.json({ matches });
  }),
};
