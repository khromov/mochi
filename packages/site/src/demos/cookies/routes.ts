import { Mochi, error, getRequestContext } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/cookies': Mochi.page('./src/demos/cookies/Cookies.svelte'),
  '/api/cookie': Mochi.api(async ({ method, request }) => {
    if (method !== 'POST') {
      error(405, 'Method Not Allowed');
    }
    const {
      username,
      theme,
      httpOnly = true,
    } = (await request.json()) as {
      username: string;
      theme: string;
      httpOnly?: boolean;
    };
    const { cookies } = getRequestContext();
    // Cookies are HttpOnly by default (framework default); pass httpOnly: false to
    // make one readable by client-side JS so the demo can show both behaviors.
    cookies.set('mochi_username', username, { path: '/', maxAge: 604800, httpOnly });
    cookies.set('mochi_theme', theme, { path: '/', maxAge: 604800, httpOnly });
    return Response.json({ ok: true });
  }),
};
