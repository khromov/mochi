import { Mochi, error, getRequestContext } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import Cookies from './Cookies.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/cookies': Mochi.page(Cookies),
  '/api/cookie': Mochi.api(async ({ method, request }) => {
    if (method !== 'POST') {
      error(405, 'Method Not Allowed');
    }
    const { username, theme } = (await request.json()) as {
      username: string;
      theme: string;
    };
    const { cookies } = getRequestContext();
    cookies.set('mochi_username', username, { path: '/', maxAge: 604800 });
    cookies.set('mochi_theme', theme, { path: '/', maxAge: 604800 });
    return Response.json({ ok: true });
  }),
};
