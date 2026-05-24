import { Mochi, fail, redirect, success, getRequestContext } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import Login from './Login.svelte';
import { createSessionToken, verifySessionToken } from './session';

const SESSION_COOKIE = 'mochi_login_session';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/login': Mochi.page(Login, {
    serverProps: () => {
      const { cookies } = getRequestContext();
      const session = verifySessionToken(cookies.get(SESSION_COOKIE));
      return { currentUser: session?.username ?? null };
    },
    actions: {
      default: async ({ formData, cookies }) => {
        const username = String(formData.get('username') ?? '').trim();
        const password = String(formData.get('password') ?? '');
        if (!username) {
          return fail(400, { error: 'Username required', username });
        }
        if (password !== 'hunter2') {
          return fail(401, { error: 'Bad credentials', username });
        }
        const { token, maxAgeSec } = createSessionToken(username);
        cookies.set(SESSION_COOKIE, token, {
          path: '/',
          httpOnly: true,
          sameSite: 'Lax',
          maxAge: maxAgeSec,
        });
        return success({ username });
      },
      logout: async ({ cookies }) => {
        cookies.delete(SESSION_COOKIE, { path: '/' });
        return redirect(303, '/demos/login');
      },
    },
  }),
};
