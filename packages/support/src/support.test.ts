import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from 'mochi-framework';
import type { ResolvedEmailMessage } from 'mochi-framework';
import { routes } from './routes';

const sent: ResolvedEmailMessage[] = [];

const post = (base: string, fields: Record<string, string>): Promise<Response> =>
  fetch(`${base}/?/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });

const valid = { captcha: 'slid', name: 'Ada', email: 'ada@example.com', message: 'Help please' };

describe('support form action', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-support-test-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      htmlShell: './src/shell.html',
      // Mirror src/index.ts, so /health/ resolves the way the deployed app serves it.
      trailingSlash: 'always',
      // The port is only known after serve() returns, so proxy.origin can't be
      // set ahead of time to satisfy the real origin check.
      csrf: { checkOrigin: false },
      email: {
        from: 'Mochi Support Form <noreply@mochi.fast>',
        transport: {
          type: 'custom',
          send: (message) => {
            sent.push(message);
          },
        },
      },
      routes,
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('GET / renders the form', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Get in touch');
  });

  test('/health/ reports ok', async () => {
    const res = await fetch(`${base}/health/`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  test('a valid submission sends one email to SUPPORT_TO', async () => {
    sent.length = 0;
    const res = await post(base, valid);
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual(['support@mochi.fast']);
    expect(sent[0]?.replyTo).toBe('ada@example.com');
    expect(sent[0]?.subject).toBe('Support request from Ada');
    // The Svelte template rendered rather than being passed through as a path.
    expect(sent[0]?.html).toContain('Help please');
    expect(sent[0]?.text).toContain('Help please');
  });

  test('an unsolved captcha is rejected and sends nothing', async () => {
    sent.length = 0;
    const res = await post(base, { ...valid, captcha: '' });
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  test('a malformed email address is rejected', async () => {
    sent.length = 0;
    const res = await post(base, { ...valid, email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  test('an empty message is rejected', async () => {
    sent.length = 0;
    const res = await post(base, { ...valid, message: '   ' });
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  test('CR/LF in the name cannot smuggle headers into the subject', async () => {
    sent.length = 0;
    const res = await post(base, { ...valid, name: 'Ada\r\nBcc: evil@example.com' });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).not.toContain('\n');
    expect(sent[0]?.subject).not.toContain('\r');
    expect(sent[0]?.subject).toBe('Support request from Ada Bcc: evil@example.com');
    expect(sent[0]?.bcc).toBeUndefined();
  });
});
