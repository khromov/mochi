import { Mochi, error } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/api': Mochi.page('./src/demos/api/Api.svelte'),
  '/health': Mochi.api(({ method }) => Response.json({ status: 'ok', method })),
  // curl -X POST http://localhost:3333/add -H 'Content-Type: application/json' -d '{"a": 2, "b": 3}'
  '/add': Mochi.api(async ({ method, request }) => {
    if (method !== 'POST') {
      error(405, 'Method Not Allowed');
    }
    const { a, b } = (await request.json()) as { a: number; b: number };
    return Response.json({ result: a + b });
  }),
};
