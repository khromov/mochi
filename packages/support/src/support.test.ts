import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi, encryptPayload } from 'mochi-framework';
import type { ResolvedEmailMessage } from 'mochi-framework';
import { CAPTCHA_AAD, powInput, leadingZeroBits } from './lib/pow';
import { routes } from './routes';

// Low difficulty + a short age floor so tests don't hash for seconds or sleep.
// Safe to set here: captcha.ts reads env lazily and this file is its own process.
process.env.CAPTCHA_POW_BITS = '8';
process.env.CAPTCHA_MIN_AGE_MS = '500';

const sent: ResolvedEmailMessage[] = [];

const post = (base: string, fields: Record<string, string>): Promise<Response> =>
  fetch(`${base}/?/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });

// Tokens are minted in-process with the same key the server derived, so they
// verify exactly like the ones serverProps embeds at SSR.
const mintToken = (ageMs = 1000): string => encryptPayload(JSON.stringify({ iat: Date.now() - ageMs, nonce: randomUUID() }), { aad: CAPTCHA_AAD });

const powFor = (token: string, passing: boolean): string => {
  for (let n = 0; ; n++) {
    const digest = createHash('sha256').update(powInput(token, String(n))).digest();
    if (leadingZeroBits(digest) >= 8 === passing) {
      return String(n);
    }
  }
};

const validFields = (token: string): Record<string, string> => ({
  captcha_token: token,
  captcha_pow: powFor(token, true),
  name: 'Ada',
  email: 'ada@example.com',
  message: 'Help please',
});

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
    const res = await post(base, validFields(mintToken()));
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual(['support@mochi.fast']);
    expect(sent[0]?.replyTo).toBe('ada@example.com');
    expect(sent[0]?.subject).toBe('Support request from Ada');
    // The Svelte template rendered rather than being passed through as a path.
    expect(sent[0]?.html).toContain('Help please');
    expect(sent[0]?.text).toContain('Help please');
  });

  test('a missing captcha token is rejected and sends nothing', async () => {
    sent.length = 0;
    const res = await post(base, { ...validFields(mintToken()), captcha_token: '', captcha_pow: '' });
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  test('a garbled captcha token is rejected', async () => {
    sent.length = 0;
    const res = await post(base, { ...validFields(mintToken()), captcha_token: 'not-a-token' });
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  test('an expired token is rejected', async () => {
    sent.length = 0;
    const res = await post(base, validFields(mintToken(16 * 60_000)));
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  test('a token younger than the age floor is rejected', async () => {
    sent.length = 0;
    const res = await post(base, validFields(mintToken(0)));
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  test('a proof-of-work below the difficulty target is rejected', async () => {
    sent.length = 0;
    const token = mintToken();
    const res = await post(base, { ...validFields(token), captcha_pow: powFor(token, false) });
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  test('a replayed token is rejected after one successful send', async () => {
    sent.length = 0;
    const fields = validFields(mintToken());
    expect((await post(base, fields)).status).toBe(200);
    expect((await post(base, fields)).status).toBe(400);
    expect(sent).toHaveLength(1);
  });

  test('a field-validation failure does not burn the nonce', async () => {
    sent.length = 0;
    const fields = validFields(mintToken());
    expect((await post(base, { ...fields, email: 'not-an-email' })).status).toBe(400);
    expect(sent).toHaveLength(0);
    expect((await post(base, fields)).status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  test('a malformed email address is rejected', async () => {
    sent.length = 0;
    const res = await post(base, { ...validFields(mintToken()), email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  test('an empty message is rejected', async () => {
    sent.length = 0;
    const res = await post(base, { ...validFields(mintToken()), message: '   ' });
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  test('CR/LF in the name cannot smuggle headers into the subject', async () => {
    sent.length = 0;
    const res = await post(base, { ...validFields(mintToken()), name: 'Ada\r\nBcc: evil@example.com' });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).not.toContain('\n');
    expect(sent[0]?.subject).not.toContain('\r');
    expect(sent[0]?.subject).toBe('Support request from Ada Bcc: evil@example.com');
    expect(sent[0]?.bcc).toBeUndefined();
  });
});
