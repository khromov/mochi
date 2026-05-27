// Previously .isolated.test.ts — all tests now run in isolated processes.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { parse as devalueParse } from 'devalue';
import { Mochi } from './Mochi';
import { fail, redirect, success } from './forms';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'css-imports', 'Page.svelte');

type GuestbookEntry = { id: string; name: string; at: number };
const guestbook: GuestbookEntry[] = [];

describe('enhance JSON envelope', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-enhance-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      proxy: { hostHeader: 'host' },
      logger: { enabled: false },
      outDir,
      routes: {
        '/api/guestbook': Mochi.api(({ method }) => {
          if (method !== 'GET') {
            return new Response('Method not allowed', { status: 405 });
          }
          return Response.json({ entries: [...guestbook].reverse() });
        }),
        '/page': Mochi.page(FIXTURE_PAGE, {
          actions: {
            default: ({ formData }) => success({ name: String(formData.get('name') ?? '') }),
            empty: () => undefined,
            failing: () => fail(422, { error: 'Invalid' }),
            jumping: () => redirect(303, '/elsewhere'),
            exploding: () => {
              throw new Error('boom');
            },
            random: () => success({ value: Math.floor(Math.random() * 100) + 1 }),
            uploadFile: async ({ formData }) => {
              const file = formData.get('file');
              if (!(file instanceof File) || file.size === 0) {
                return fail(400, { error: 'No file selected' });
              }
              const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
              if (ext !== 'txt' && ext !== 'md') {
                return fail(400, { error: 'Only .txt and .md files are accepted' });
              }
              if (file.size > 100 * 1024) {
                return fail(400, { error: 'File too large (max 100 KB)' });
              }
              const content = await file.text();
              return success({ filename: file.name, content, size: file.size });
            },
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
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  const post = (action: string, body: string, extra: Record<string, string> = {}): Promise<Response> =>
    fetch(`${base}/page${action}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'x-mochi-action': 'true',
        'content-type': 'application/x-www-form-urlencoded',
        origin: base,
        ...extra,
      },
      body,
    });

  // No content-type: fetch sets the multipart boundary automatically, mirroring
  // what enhance.client.ts does when the form is enctype="multipart/form-data".
  const postMultipart = (action: string, formData: FormData): Promise<Response> =>
    fetch(`${base}/page${action}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'x-mochi-action': 'true',
        origin: base,
      },
      body: formData,
    });

  describe('Random roll (enhanced return data)', () => {
    test('?/random → success envelope with { value: 1..100 }', async () => {
      const res = await post('?/random', '');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      const body = (await res.json()) as { type: string; status: number; data?: string };
      expect(body.type).toBe('success');
      expect(body.status).toBe(200);
      const data = devalueParse(body.data!) as { value: number };
      expect(typeof data.value).toBe('number');
      expect(data.value).toBeGreaterThanOrEqual(1);
      expect(data.value).toBeLessThanOrEqual(100);
    });

    test('default action echoes submitted form data through the envelope', async () => {
      const res = await post('', 'name=alice');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { type: string; status: number; data?: string };
      expect(body.type).toBe('success');
      expect(body.status).toBe(200);
      expect(devalueParse(body.data!)).toEqual({ name: 'alice' });
    });
  });

  describe('Form errors', () => {
    test('fail() → HTTP 200 with { type: "failure", status, data }', async () => {
      const res = await post('?/failing', '');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { type: string; status: number; data?: string };
      expect(body.type).toBe('failure');
      expect(body.status).toBe(422);
      expect(devalueParse(body.data!)).toEqual({ error: 'Invalid' });
    });

    test('thrown error → error envelope with HTTP error status', async () => {
      const res = await post('?/exploding', '');
      expect(res.status).toBe(500);
      const body = (await res.json()) as { type: string; status?: number; error?: { message: string } };
      expect(body.type).toBe('error');
      expect(body.status).toBe(500);
      expect(body.error?.message).toBe('boom');
    });
  });

  describe('Form redirects', () => {
    test('enhanced ?/jumping → HTTP 200 with { type: "redirect", status, location }', async () => {
      const res = await post('?/jumping', '');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { type: string; status: number; location: string };
      expect(body.type).toBe('redirect');
      expect(body.status).toBe(303);
      expect(body.location).toBe('/elsewhere');
    });

    test('non-enhanced POST with redirect() → HTTP 303 + Location header (not JSON)', async () => {
      const res = await fetch(`${base}/page?/jumping`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          accept: 'text/html',
          'content-type': 'application/x-www-form-urlencoded',
          origin: base,
        },
        body: '',
      });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/elsewhere');
    });
  });

  describe('File uploads', () => {
    test('happy path: .txt file → success envelope with { filename, content, size }', async () => {
      const fd = new FormData();
      fd.append('file', new File(['hello world'], 'note.txt', { type: 'text/plain' }));
      const res = await postMultipart('?/uploadFile', fd);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { type: string; status: number; data?: string };
      expect(body.type).toBe('success');
      expect(body.status).toBe(200);
      expect(devalueParse(body.data!)).toEqual({
        filename: 'note.txt',
        content: 'hello world',
        size: 11,
      });
    });

    test('wrong extension → failure envelope with extension error', async () => {
      const fd = new FormData();
      fd.append('file', new File(['png-bytes'], 'image.png', { type: 'image/png' }));
      const res = await postMultipart('?/uploadFile', fd);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { type: string; status: number; data?: string };
      expect(body.type).toBe('failure');
      expect(body.status).toBe(400);
      const data = devalueParse(body.data!) as { error: string };
      expect(data.error).toMatch(/Only \.txt and \.md/);
    });

    test('file too large → failure envelope with size error', async () => {
      const fd = new FormData();
      const big = 'x'.repeat(100 * 1024 + 1);
      fd.append('file', new File([big], 'big.txt', { type: 'text/plain' }));
      const res = await postMultipart('?/uploadFile', fd);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { type: string; status: number; data?: string };
      expect(body.type).toBe('failure');
      expect(body.status).toBe(400);
      const data = devalueParse(body.data!) as { error: string };
      expect(data.error).toMatch(/max 100 KB/);
    });

    test('missing file → failure envelope with "No file selected"', async () => {
      const fd = new FormData();
      const res = await postMultipart('?/uploadFile', fd);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { type: string; status: number; data?: string };
      expect(body.type).toBe('failure');
      expect(body.status).toBe(400);
      expect(devalueParse(body.data!)).toEqual({ error: 'No file selected' });
    });
  });

  describe('Guestbook (reloading associated data)', () => {
    beforeEach(() => {
      guestbook.length = 0;
    });

    test('signed entry shows up on a follow-up GET /api/guestbook', async () => {
      const signRes = await post('?/guestbookSign', 'name=alice');
      expect(signRes.status).toBe(200);
      const signed = (await signRes.json()) as { type: string; status: number };
      expect(signed.type).toBe('success');
      expect(signed.status).toBe(200);

      const listRes = await fetch(`${base}/api/guestbook`);
      expect(listRes.status).toBe(200);
      const list = (await listRes.json()) as { entries: GuestbookEntry[] };
      expect(list.entries.length).toBe(1);
      expect(list.entries[0]?.name).toBe('alice');
    });

    test('empty name → failure envelope, guestbook stays empty', async () => {
      const res = await post('?/guestbookSign', 'name=');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { type: string; status: number; data?: string };
      expect(body.type).toBe('failure');
      expect(body.status).toBe(400);
      expect(devalueParse(body.data!)).toEqual({ error: 'Name required' });

      const listRes = await fetch(`${base}/api/guestbook`);
      const list = (await listRes.json()) as { entries: GuestbookEntry[] };
      expect(list.entries.length).toBe(0);
    });
  });

  describe('Misc / extras', () => {
    test('action returning undefined → status 204 in body, no data field', async () => {
      const res = await post('?/empty', '');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { type: string; status: number; data?: string };
      expect(body.type).toBe('success');
      expect(body.status).toBe(204);
      expect(body.data).toBeUndefined();
    });

    test('unknown action name → 404 error envelope', async () => {
      const res = await post('?/missing', '');
      expect(res.status).toBe(404);
      const body = (await res.json()) as { type: string; status?: number; error?: { message: string } };
      expect(body.type).toBe('error');
      expect(body.status).toBe(404);
      expect(body.error?.message).toContain('Unknown form action');
    });

    test('non-enhanced POST (no Accept JSON) → HTML re-render, not JSON', async () => {
      const res = await fetch(`${base}/page`, {
        method: 'POST',
        headers: {
          accept: 'text/html',
          'content-type': 'application/x-www-form-urlencoded',
          origin: base,
        },
        body: 'name=bob',
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type') ?? '').not.toContain('application/json');
      const text = await res.text();
      expect(text).toContain('css-import-fixture');
    });

    test('POST with Accept preferring text/html over json → not treated as enhanced', async () => {
      const res = await fetch(`${base}/page`, {
        method: 'POST',
        headers: {
          accept: 'text/html, application/json;q=0.01',
          'content-type': 'application/x-www-form-urlencoded',
          origin: base,
        },
        body: 'name=carol',
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
    });

    test('enhanced POST that fails CSRF → JSON error envelope, not HTML', async () => {
      const res = await fetch(`${base}/page`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'x-mochi-action': 'true',
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'https://evil.example.com',
        },
        body: 'name=alice',
      });
      expect(res.status).toBe(403);
      expect(res.headers.get('content-type')).toContain('application/json');
      const body = (await res.json()) as { type: string; status?: number; error?: { message: string } };
      expect(body.type).toBe('error');
      expect(body.status).toBe(403);
    });
  });
});
