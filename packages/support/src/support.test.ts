import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi, mintCaptcha, solveCaptcha } from 'mochi-framework';
import type { ResolvedEmailMessage } from 'mochi-framework';

// The suite's temp dir doubles as the outDir and the SQLite location. Both the
// db path and the admin credentials must be in place before `./routes` and its
// transitive `./db.server` are evaluated, hence the dynamic imports.
const outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-support-test-'));
process.env.SUPPORT_DB = path.join(outDir, 'support.sqlite');
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'letmein';
// The real 5s tarpit on a rejected /admin attempt would blow every timeout here.
process.env.ADMIN_AUTH_DELAY_MS = '80';

const { routes } = await import('./routes');
const { SUPPORT_EMAIL_QUEUE, supportEmailQueue } = await import('./jobs.server');
const { closeDb, emailLogsBySubmission, listSubmissions } = await import('./db.server');
const { adminAuth } = await import('./adminAuth');

const sent: ResolvedEmailMessage[] = [];

const AUTH = { Authorization: `Basic ${Buffer.from('admin:letmein').toString('base64')}` };

const post = (base: string, fields: Record<string, string>): Promise<Response> =>
  fetch(`${base}/?/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });

const adminPost = (base: string, action: string, id: number): Promise<Response> =>
  fetch(`${base}/admin/?/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...AUTH },
    body: new URLSearchParams({ id: String(id) }).toString(),
    redirect: 'manual',
  });

/** The send is now a background job, so the assertion has to wait for the worker. */
const waitForSent = async (count: number): Promise<void> => {
  for (let i = 0; i < 200 && sent.length < count; i++) {
    await Bun.sleep(10);
  }
};

// Minted + solved in-process against the same key and options the server
// derived, so these verify exactly like the ones a real slide produces.
// The captcha's own rules (expiry, age floor, PoW strength, chain derivation)
// are covered by the framework's captcha tests; this suite is about the
// action's ordering and field validation.
const validFields = (): Record<string, string> => ({
  ...solveCaptcha(mintCaptcha()),
  name: 'Ada',
  email: 'ada@example.com',
  message: 'Help please',
});

describe('support form action', () => {
  let server: Server<undefined>;
  let base: string;

  beforeAll(async () => {
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
      // Mirrors the deployed proxy trust, so the /admin/ client-address footer
      // and the rate limiter's key are exercised the way production resolves them.
      proxy: { addressHeader: 'x-forwarded-for', xffDepth: 1 },
      // Low difficulty and no age floor so tests don't hash for seconds or sleep.
      captcha: { bits: 8, minAgeMs: 0 },
      email: {
        from: 'Mochi Support Form <noreply@mochi.fast>',
        transport: {
          type: 'custom',
          send: (message) => {
            sent.push(message);
          },
        },
      },
      handle: adminAuth,
      queues: { [SUPPORT_EMAIL_QUEUE]: supportEmailQueue },
      routes,
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(async () => {
    server.stop(true);
    // The SQLite file lives inside outDir, and Windows keeps it locked while a
    // handle is open — then releases the lock asynchronously, so an immediate rm
    // still throws EBUSY. Close the handle, then retry (Bun ignores rmSync's
    // maxRetries). Best-effort cleanup of a temp dir: never fail the suite over
    // it, the OS reclaims it on exit regardless.
    closeDb();
    for (let attempt = 0; attempt < 25; attempt++) {
      try {
        rmSync(outDir, { recursive: true, force: true });
        return;
      } catch {
        await Bun.sleep(100);
      }
    }
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

  test('a valid submission is stored and sends one email to SUPPORT_TO', async () => {
    sent.length = 0;
    const res = await post(base, validFields());
    expect(res.status).toBe(200);
    await waitForSent(1);
    expect(sent).toHaveLength(1);
    const stored = listSubmissions(false).find((s) => s.message === 'Help please');
    expect(stored?.email).toBe('ada@example.com');
    expect(stored?.email_status).toBe('sent');
    expect(sent[0]?.to).toEqual(['support@mochi.fast']);
    expect(sent[0]?.replyTo).toBe('ada@example.com');
    expect(sent[0]?.subject).toBe('Support request from Ada');
    // The Svelte template rendered rather than being passed through as a path.
    expect(sent[0]?.html).toContain('Help please');
    expect(sent[0]?.text).toContain('Help please');
  });

  test('a missing captcha token is rejected and sends nothing', async () => {
    sent.length = 0;
    const res = await post(base, { ...validFields(), captcha_token: '', captcha_pow: '' });
    expect(res.status).toBe(400);
    // Long enough for a job to have been picked up, had one been enqueued.
    await Bun.sleep(50);
    expect(sent).toHaveLength(0);
  });

  test('a garbled captcha token is rejected', async () => {
    sent.length = 0;
    const res = await post(base, { ...validFields(), captcha_token: 'not-a-token' });
    expect(res.status).toBe(400);
    await Bun.sleep(50);
    expect(sent).toHaveLength(0);
  });

  test('a replayed token is rejected after one successful send', async () => {
    sent.length = 0;
    const fields = validFields();
    expect((await post(base, fields)).status).toBe(200);
    expect((await post(base, fields)).status).toBe(400);
    await waitForSent(1);
    expect(sent).toHaveLength(1);
  });

  test('a field-validation failure does not burn the nonce', async () => {
    sent.length = 0;
    const fields = validFields();
    expect((await post(base, { ...fields, email: 'not-an-email' })).status).toBe(400);
    await Bun.sleep(50);
    expect(sent).toHaveLength(0);
    expect((await post(base, fields)).status).toBe(200);
    await waitForSent(1);
    expect(sent).toHaveLength(1);
  });

  test('a malformed email address is rejected', async () => {
    sent.length = 0;
    const res = await post(base, { ...validFields(), email: 'not-an-email' });
    expect(res.status).toBe(400);
    await Bun.sleep(50);
    expect(sent).toHaveLength(0);
  });

  test('an empty message is rejected', async () => {
    sent.length = 0;
    const res = await post(base, { ...validFields(), message: '   ' });
    expect(res.status).toBe(400);
    await Bun.sleep(50);
    expect(sent).toHaveLength(0);
  });

  test('CR/LF in the name cannot smuggle headers into the subject', async () => {
    sent.length = 0;
    const res = await post(base, { ...validFields(), name: 'Ada\r\nBcc: evil@example.com' });
    expect(res.status).toBe(200);
    await waitForSent(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).not.toContain('\n');
    expect(sent[0]?.subject).not.toContain('\r');
    expect(sent[0]?.subject).toBe('Support request from Ada Bcc: evil@example.com');
    expect(sent[0]?.bcc).toBeUndefined();
  });

  test('the delivery log records queued → sending → sent', async () => {
    const id = listSubmissions(false).find((s) => s.message === 'Help please')?.id;
    expect(id).toBeDefined();
    const entries = emailLogsBySubmission()[id as number] ?? [];
    expect(entries.map((e) => e.event)).toEqual(['queued', 'sending', 'sent']);
    expect(entries.at(-1)?.detail).toContain('transport: custom');
  });

  test('/admin/ demands basic auth, and the challenge is not delayed', async () => {
    const started = performance.now();
    const res = await fetch(`${base}/admin/`);
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Basic');
    // Sending no credentials is how a browser gets the login prompt — it is
    // neither tarpitted nor charged quota; only a wrong guess is.
    expect(performance.now() - started).toBeLessThan(80);
    expect(res.headers.get('RateLimit-Remaining')).toBeNull();
  });

  test('/admin/ rejects a wrong password, after the tarpit delay', async () => {
    const started = performance.now();
    const res = await fetch(`${base}/admin/`, { headers: { Authorization: `Basic ${Buffer.from('admin:nope').toString('base64')}` } });
    expect(res.status).toBe(401);
    expect(performance.now() - started).toBeGreaterThanOrEqual(80);
  });

  test('/admin/ lists submissions once authenticated', async () => {
    const res = await fetch(`${base}/admin/`, { headers: AUTH });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('ada@example.com');
  });

  // Runs after the render above, so the component is already compiled and the
  // only thing this can be measuring is the tarpit.
  test('correct credentials are never delayed', async () => {
    const started = performance.now();
    expect((await fetch(`${base}/admin/`, { headers: AUTH })).status).toBe(200);
    expect(performance.now() - started).toBeLessThan(80);
  });

  test('handled submissions move between the two lists', async () => {
    const id = listSubmissions(false)[0]?.id;
    expect(id).toBeDefined();

    expect((await adminPost(base, 'handle', id as number)).status).toBe(303);
    expect(listSubmissions(false).some((s) => s.id === id)).toBe(false);
    expect(listSubmissions(true).some((s) => s.id === id)).toBe(true);

    expect((await adminPost(base, 'unhandle', id as number)).status).toBe(303);
    expect(listSubmissions(false).some((s) => s.id === id)).toBe(true);
    expect(listSubmissions(true).some((s) => s.id === id)).toBe(false);
  });

  test('/admin/ footer reports the proxy-resolved client address', async () => {
    const res = await fetch(`${base}/admin/`, { headers: { ...AUTH, 'X-Forwarded-For': '203.0.113.9, 10.0.0.2' } });
    const html = await res.text();
    // xffDepth 1 → the rightmost entry, the innermost trusted proxy's view.
    expect(html).toContain('10.0.0.2');
    expect(html).toContain('203.0.113.9, 10.0.0.2');
  });

  // Keep this last: the limiter buckets by client address, so once it trips
  // every later unauthenticated /admin/ assertion in this file would get a 429.
  test('repeated wrong passwords are rate limited, but the right one still gets in', async () => {
    const wrong = { Authorization: `Basic ${Buffer.from('admin:nope').toString('base64')}` };
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await fetch(`${base}/admin/`, { headers: wrong })).status);
    }
    expect(statuses).toContain(429);
    expect(statuses.at(-1)).toBe(429);
    // Correct credentials skip the limiter entirely, so a ban never locks out
    // someone who knows the password.
    expect((await fetch(`${base}/admin/`, { headers: AUTH })).status).toBe(200);
  });
});
