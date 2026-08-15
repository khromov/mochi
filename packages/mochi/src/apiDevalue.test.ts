// Previously .isolated.test.ts — all tests now run in isolated processes.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { fetchDevalue, MochiFetchError } from './runtime/fetchDevalue';
import { MochiHttpError } from './utils';

describe('Mochi.apiDevalue', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-api-devalue-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {
        '/api/todos/:id': Mochi.apiDevalue(({ params }) => ({
          id: Number(params.id),
          title: 'Write docs',
          due: new Date('2026-01-02T03:04:05.000Z'),
          tags: new Set(['a', 'b']),
          meta: new Map([['key', 'value']]),
        })),
        '/api/teapot': Mochi.apiDevalue(() => {
          throw new MochiHttpError(418, 'short and stout');
        }),
        '/api/raw': Mochi.apiDevalue(() => new Response('raw-body', { headers: { 'Content-Type': 'text/plain' } })),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('round-trips rich values through fetchDevalue', async () => {
    const todo = await fetchDevalue<{ id: number; title: string; due: Date; tags: Set<string>; meta: Map<string, string> }>(`${base}/api/todos/7`);
    expect(todo.id).toBe(7);
    expect(todo.title).toBe('Write docs');
    expect(todo.due).toBeInstanceOf(Date);
    expect(todo.due.toISOString()).toBe('2026-01-02T03:04:05.000Z');
    expect(todo.tags).toBeInstanceOf(Set);
    expect([...todo.tags]).toEqual(['a', 'b']);
    expect(todo.meta).toBeInstanceOf(Map);
    expect(todo.meta.get('key')).toBe('value');
  });

  test('serves the devalue content type', async () => {
    const res = await fetch(`${base}/api/todos/1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/devalue+json; charset=utf-8');
  });

  test('a thrown MochiHttpError surfaces as MochiFetchError with the status and message', async () => {
    expect.assertions(3);
    try {
      await fetchDevalue(`${base}/api/teapot`);
    } catch (err) {
      expect(err).toBeInstanceOf(MochiFetchError);
      expect((err as MochiFetchError).status).toBe(418);
      expect((err as MochiFetchError).message).toBe('short and stout');
    }
  });

  test('a returned Response passes through unchanged', async () => {
    const res = await fetch(`${base}/api/raw`);
    expect(await res.text()).toBe('raw-body');
    expect(res.headers.get('content-type')).toBe('text/plain');
  });
});
