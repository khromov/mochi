import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi, fetchDevalue } from 'mochi-framework';
import { getTodo } from './lib/todos';
import type { Todo } from './lib/todos';

describe('capacitor template web app', () => {
  let server: Server<undefined> | undefined;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-capacitor-test-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      htmlShell: './src/shell.html',
      handle: async ({ event, resolve }) => {
        const response = await resolve(event);
        if (event.url.pathname.startsWith('/api/')) {
          response.headers.set('Access-Control-Allow-Origin', '*');
        }
        return response;
      },
      routes: {
        '/': Mochi.page('./src/Home.svelte'),
        '/api/todos/:id': Mochi.apiDevalue(({ params }) => getTodo(Number(params.id))),
      },
    });
    base = `http://localhost:${server.port}`;
    // Compiles the app inside the hook, which overruns bun's 5s default when the root `bun run test`
    // fans every workspace out in parallel.
  }, 60_000);

  afterAll(() => {
    // Guarded: if `beforeAll` failed, an unconditional stop() throws and buries the real error.
    server?.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('GET / renders the shared Home page with the Greeting island', async () => {
    const res = await fetch(base);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Mochi × Capacitor');
    expect(html).toContain('mochi-hydratable-island');
  });

  test('the devalue API serves rich todos with CORS for the standalone app', async () => {
    const res = await fetch(`${base}/api/todos/1`);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('content-type')).toBe('application/devalue+json; charset=utf-8');

    const todo = await fetchDevalue<Todo>(`${base}/api/todos/1`);
    expect(todo.title).toBe('Ship the web app');
    expect(todo.due).toBeInstanceOf(Date);
  });
});
