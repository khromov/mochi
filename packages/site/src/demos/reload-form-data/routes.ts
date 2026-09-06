import { Mochi, fail, success } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

type GuestbookEntry = { id: string; name: string; at: number };
const guestbook: GuestbookEntry[] = [];
const MAX_ENTRIES = 100;

export const routes: Record<string, MochiRouteValue> = {
  '/api/guestbook': Mochi.api(({ method }) => {
    if (method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }
    return Response.json({ entries: [...guestbook].reverse() });
  }),
  '/demos/reload-form-data': Mochi.page('./src/demos/reload-form-data/ReloadFormData.svelte', {
    rateLimit: { limit: 20, window: '1m' },
    serverProps: () => ({ guestbook: [...guestbook].reverse() }),
    actions: {
      guestbookSign: ({ formData }) => {
        const name = String(formData.get('name') ?? '').trim();
        if (!name) {
          return fail(400, { error: 'Name required' });
        }
        if (name.length > 50) {
          return fail(400, { error: 'Name too long (max 50 chars)' });
        }
        guestbook.push({ id: crypto.randomUUID(), name, at: Date.now() });
        if (guestbook.length > MAX_ENTRIES) {
          guestbook.shift();
        }
        return success({});
      },
    },
  }),
};
