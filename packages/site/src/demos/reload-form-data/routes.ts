import { Mochi, fail, success } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import ReloadFormData from './ReloadFormData.svelte';

type GuestbookEntry = { id: string; name: string; at: number };
const guestbook: GuestbookEntry[] = [];

export const routes: Record<string, MochiRouteValue> = {
  '/api/guestbook': Mochi.api(({ method }) => {
    if (method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }
    return Response.json({ entries: [...guestbook].reverse() });
  }),
  '/demos/reload-form-data': Mochi.page(ReloadFormData, {
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
        return success({});
      },
    },
  }),
};
