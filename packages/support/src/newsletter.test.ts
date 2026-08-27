import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { parse } from 'devalue';
import { Mochi, mintCaptcha, solveCaptcha, sequence } from 'mochi-framework';
import type { ResolvedEmailMessage } from 'mochi-framework';

// The db path and admin credentials must be set before `./routes` and its
// transitive `./db.server` are evaluated.
const outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-newsletter-test-'));
process.env.SUPPORT_DB = path.join(outDir, 'support.sqlite');
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'letmein';
process.env.ADMIN_AUTH_DELAY_MS = '80';
process.env.MOCHI_ORIGIN = 'https://support.test';
process.env.NEWSLETTER_EMBED_ANCESTORS = 'https://mochi.test';

const { routes } = await import('./routes');
const { newsletterEmailQueue } = await import('./newsletter/jobs.server');
const {
  closeDb,
  confirmSubscriber,
  listSubscribers,
  newsletterLogsBySubscriber,
  requestSubscription,
  claimNewsletterSend,
  refreshConfirmToken,
  markNewsletterEmailFailed,
  getSubscriber,
} = await import('./db.server');
const { adminAuth } = await import('./adminAuth');
const { embedHeaders, embedAncestors } = await import('./embedHeaders');

const sent: ResolvedEmailMessage[] = [];

const AUTH = { Authorization: `Basic ${Buffer.from('admin:letmein').toString('base64')}` };

const subscribe = (base: string, fields: Record<string, string>, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(`${base}/newsletter/embed/?/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(fields).toString(),
  });

const waitForSent = async (count: number): Promise<void> => {
  for (let i = 0; i < 200 && sent.length < count; i++) {
    await Bun.sleep(10);
  }
};

const validFields = (email = 'ada@example.com'): Record<string, string> => ({
  ...solveCaptcha(mintCaptcha()),
  email,
  source: 'mochi-0-9-0',
});

const rowFor = (email: string) => listSubscribers().find((s) => s.email_key === email.toLowerCase());

const tokenFrom = (message: ResolvedEmailMessage | undefined, page: 'confirm' | 'unsubscribe'): string => {
  const match = new RegExp(`/newsletter/${page}/\\?token=([A-Za-z0-9_-]+)`).exec(message?.text ?? '');
  return match?.[1] ?? '';
};

describe('newsletter signup', () => {
  let server: Server<undefined>;
  let base: string;

  beforeAll(async () => {
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      htmlShell: './src/shell.html',
      trailingSlash: 'always',
      // The port is only known after serve() returns.
      csrf: { checkOrigin: false },
      captcha: { bits: 8, minAgeMs: 0 },
      email: {
        from: 'Mochi <noreply@mochi.fast>',
        transport: {
          type: 'custom',
          send: (message) => {
            sent.push(message);
          },
        },
      },
      handle: sequence(adminAuth, embedHeaders),
      queues: [newsletterEmailQueue],
      // Mirrors src/index.ts's durable storage; the file joins the temp dir the afterAll retry-loop already cleans up.
      queueStorage: { sqlite: path.join(outDir, 'queue.sqlite') },
      routes,
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(async () => {
    server.stop(true);
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

  test('the embed route is framable by the configured ancestors only', async () => {
    const res = await fetch(`${base}/newsletter/embed/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'self' https://mochi.test");
    // Would override the CSP in older browsers and block the embed outright.
    expect(res.headers.get('X-Frame-Options')).toBeNull();
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
  });

  test('the CSP is scoped to the embed', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
  });

  // The widget loads on the blog index and every post, so page views must not
  // spend the signup quota — an ordinary reader would otherwise earn the ban.
  test('reading past the rate limit never blocks the embed, only the POST counts', async () => {
    for (let i = 0; i < 25; i++) {
      expect((await fetch(`${base}/newsletter/embed/`)).status).toBe(200);
    }
  });

  test('a valid signup stores a pending row and mails one confirmation link', async () => {
    sent.length = 0;
    const res = await subscribe(base, validFields());
    expect(res.status).toBe(200);
    await waitForSent(1);
    expect(sent).toHaveLength(1);

    const row = rowFor('ada@example.com');
    expect(row?.status).toBe('pending');
    expect(row?.source).toBe('mochi-0-9-0');
    expect(row?.email_status).toBe('sent');

    expect(sent[0]?.to).toEqual(['ada@example.com']);
    expect(sent[0]?.text).toContain('https://support.test/newsletter/confirm/?token=');
    expect(sent[0]?.html).toContain('Confirm subscription');
    expect(sent[0]?.headers?.['List-Unsubscribe']).toContain('/newsletter/unsubscribe/?token=');
  });

  test('a filled honeypot looks like success but stores nothing', async () => {
    sent.length = 0;
    const before = listSubscribers().length;
    const res = await subscribe(base, { ...validFields('bot@example.com'), website: 'http://spam.example' });
    expect(res.status).toBe(200);
    await Bun.sleep(50);
    expect(sent).toHaveLength(0);
    expect(listSubscribers()).toHaveLength(before);
  });

  test('a missing captcha token is rejected', async () => {
    sent.length = 0;
    const res = await subscribe(base, { ...validFields('nope@example.com'), captcha_token: '', captcha_pow: '' });
    expect(res.status).toBe(400);
    await Bun.sleep(50);
    expect(sent).toHaveLength(0);
    expect(rowFor('nope@example.com')).toBeUndefined();
  });

  test('a malformed address is rejected without burning the nonce', async () => {
    sent.length = 0;
    const fields = validFields('grace@example.com');
    expect((await subscribe(base, { ...fields, email: 'not-an-email' })).status).toBe(400);
    await Bun.sleep(50);
    expect(sent).toHaveLength(0);
    expect((await subscribe(base, fields)).status).toBe(200);
    await waitForSent(1);
    expect(sent).toHaveLength(1);
  });

  test('re-subscribing inside the cooldown says so rather than promising a second link', async () => {
    sent.length = 0;
    const before = listSubscribers().length;
    const res = await subscribe(base, validFields(), { 'x-mochi-action': 'true' });
    expect(res.status).toBe(200);
    const envelope = (await res.json()) as { type: string; data?: string };
    expect(envelope.type).toBe('success');
    // The envelope's `data` is devalue-encoded, which is what the widget decodes.
    expect(parse(envelope.data ?? 'null')).toEqual({ throttled: true, retryAfterMinutes: 5 });
    await Bun.sleep(50);
    expect(sent).toHaveLength(0);
    expect(listSubscribers()).toHaveLength(before);
  });

  // An `already` answer has to arm the cooldown as well, or two quick submits tell
  // a confirmed address (already → already) from an unknown one (created → throttled).
  test('a confirmed address arms the cooldown exactly like a new one', () => {
    const open = { cooldownMs: 0, ttlMs: 60_000 };
    const closed = { cooldownMs: 60_000, ttlMs: 60_000 };

    expect(requestSubscription({ email: 'fresh@cooldown.test', source: '' }, open).kind).toBe('created');

    const member = requestSubscription({ email: 'member@cooldown.test', source: '' }, open);
    confirmSubscriber(member.id);
    expect(requestSubscription({ email: 'member@cooldown.test', source: '' }, open).kind).toBe('already');

    expect(requestSubscription({ email: 'fresh@cooldown.test', source: '' }, closed).kind).toBe('throttled');
    expect(requestSubscription({ email: 'member@cooldown.test', source: '' }, closed).kind).toBe('throttled');
  });

  test('confirming flips the row, and a second click is idempotent', async () => {
    sent.length = 0;
    expect((await subscribe(base, validFields('linus@example.com'))).status).toBe(200);
    await waitForSent(1);
    const token = tokenFrom(sent[0], 'confirm');
    expect(token).not.toBe('');

    const first = await fetch(`${base}/newsletter/confirm/?token=${token}`);
    expect(first.status).toBe(200);
    expect(await first.text()).toContain("You're subscribed");
    expect(rowFor('linus@example.com')?.status).toBe('confirmed');

    const second = await fetch(`${base}/newsletter/confirm/?token=${token}`);
    expect(second.status).toBe(200);
    expect(await second.text()).toContain('already subscribed');
    expect(rowFor('linus@example.com')?.status).toBe('confirmed');
  });

  // The anti-enumeration property: the answer may depend on when an address was
  // last submitted, never on whether it is on the list — so a confirmed address
  // and a pending one, both submitted moments ago, must come back identical.
  // Compared over the JSON action response, which is what the widget's `enhance`
  // submission actually receives.
  test('subscribing an already-confirmed address answers exactly like a pending one', async () => {
    sent.length = 0;
    expect(rowFor('linus@example.com')?.status).toBe('confirmed');
    expect(rowFor('ada@example.com')?.status).toBe('pending');

    const pending = await subscribe(base, validFields('ada@example.com'), { 'x-mochi-action': 'true' });
    const confirmed = await subscribe(base, validFields('linus@example.com'), { 'x-mochi-action': 'true' });

    expect(confirmed.status).toBe(pending.status);
    expect(await confirmed.text()).toBe(await pending.text());

    const fresh = await subscribe(base, validFields('grace-hopper@example.com'), { 'x-mochi-action': 'true' });
    expect(fresh.status).toBe(200);

    await waitForSent(1);
    await Bun.sleep(50);
    // Only the genuinely new address was mailed.
    expect(sent.flatMap((m) => m.to)).toEqual(['grace-hopper@example.com']);
    expect(rowFor('linus@example.com')?.status).toBe('confirmed');
  });

  test('a bogus token renders the invalid state rather than failing', async () => {
    const res = await fetch(`${base}/newsletter/confirm/?token=not-a-real-token`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("doesn't work");
  });

  test('unsubscribing works, and a fresh signup re-arms the row with a new token', async () => {
    sent.length = 0;
    expect((await subscribe(base, validFields('rich@example.com'))).status).toBe(200);
    await waitForSent(1);
    const unsubToken = tokenFrom(sent[0], 'unsubscribe');
    const oldConfirm = tokenFrom(sent[0], 'confirm');

    const res = await fetch(`${base}/newsletter/unsubscribe/?token=${unsubToken}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("You're unsubscribed");
    expect(rowFor('rich@example.com')?.status).toBe('unsubscribed');

    sent.length = 0;
    expect((await subscribe(base, validFields('rich@example.com'))).status).toBe(200);
    await waitForSent(1);
    const row = rowFor('rich@example.com');
    expect(row?.status).toBe('pending');
    expect(row?.confirm_token).not.toBe(oldConfirm);
    const stale = await fetch(`${base}/newsletter/confirm/?token=${oldConfirm}`);
    expect(await stale.text()).toContain("doesn't work");
  });

  test('the delivery log records queued → sending → sent', async () => {
    const id = rowFor('ada@example.com')?.id;
    expect(id).toBeDefined();
    const entries = newsletterLogsBySubscriber()[id as number] ?? [];
    expect(entries.map((e) => e.event)).toEqual(['queued', 'sending', 'sent']);
    expect(entries.at(-1)?.detail).toContain('transport: custom');
  });

  test('/admin/ lists subscribers on the newsletter tab once authenticated', async () => {
    const anonymous = await fetch(`${base}/admin/?tab=newsletter`);
    expect(anonymous.status).toBe(401);

    const res = await fetch(`${base}/admin/?tab=newsletter`, { headers: AUTH });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('ada@example.com');

    const support = await fetch(`${base}/admin/`, { headers: AUTH });
    expect(await support.text()).not.toContain('ada@example.com');
  });

  test('the admin resend mints a new token and mails it', async () => {
    sent.length = 0;
    const row = rowFor('ada@example.com');
    expect(row?.status).toBe('pending');

    const res = await fetch(`${base}/admin/?/resendConfirmation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...AUTH },
      body: new URLSearchParams({ id: String(row?.id) }).toString(),
      redirect: 'manual',
    });
    expect(res.status).toBe(303);
    await waitForSent(1);
    expect(sent).toHaveLength(1);
    expect(tokenFrom(sent[0], 'confirm')).not.toBe(row?.confirm_token);
  });

  test('the send claim lets only one job mail a confirmation, until a resend re-arms it', async () => {
    sent.length = 0;
    await subscribe(base, validFields('claim@example.com'));
    await waitForSent(1);
    const id = rowFor('claim@example.com')!.id;
    expect(getSubscriber(id)?.email_status).toBe('sent');

    // A duplicate/superseded job finds a non-pending row and is refused.
    expect(claimNewsletterSend(id)).toBe(false);

    // A resend re-arms the row; exactly one job then wins the claim.
    refreshConfirmToken(id, 60_000);
    expect(claimNewsletterSend(id)).toBe(true);
    expect(claimNewsletterSend(id)).toBe(false);
  });

  test('a resend clears a prior delivery error so no stale error lingers on the re-queued row', async () => {
    sent.length = 0;
    await subscribe(base, validFields('stale@example.com'));
    await waitForSent(1);
    const id = rowFor('stale@example.com')!.id;

    markNewsletterEmailFailed(id, 'SMTP timeout');
    expect(getSubscriber(id)?.email_status).toBe('failed');
    expect(getSubscriber(id)?.email_error).toBe('SMTP timeout');

    refreshConfirmToken(id, 60_000);
    const row = getSubscriber(id);
    expect(row?.email_status).toBe('pending');
    expect(row?.email_error).toBeNull();
  });

  // A stale admin tab, or a row deleted in another window, must not 500.
  test('an admin action against an unknown id is a no-op redirect', async () => {
    sent.length = 0;
    const before = listSubscribers().length;

    for (const action of ['resendConfirmation', 'unsubscribeSignup', 'deleteSignup']) {
      for (const id of ['', '999999', 'not-a-number']) {
        const res = await fetch(`${base}/admin/?/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...AUTH },
          body: new URLSearchParams({ id }).toString(),
          redirect: 'manual',
        });
        expect(res.status).toBe(303);
      }
    }

    await Bun.sleep(50);
    expect(sent).toHaveLength(0);
    expect(listSubscribers()).toHaveLength(before);
  });
});

// Env goes in per call rather than onto `process.env`: mutating the real one leaks into whatever else this file
// evaluates afterwards, and NODE_ENV in particular is read by dependencies far outside this describe.
describe('embed ancestors', () => {
  test('an explicit allow-list wins', () => {
    expect(embedAncestors({ NEWSLETTER_EMBED_ANCESTORS: 'https://a.test  https://b.test' })).toEqual(['https://a.test', 'https://b.test']);
  });

  test('production falls back to the mochi.fast origins alone', () => {
    expect(embedAncestors({ NODE_ENV: 'production' })).toEqual(['https://mochi.fast', 'https://www.mochi.fast']);
  });

  test('development also allows the local site and smoke-test ports', () => {
    const ancestors = embedAncestors({ NODE_ENV: 'development', SUPPORT_DEV: '1' });
    expect(ancestors).toContain('http://localhost:3333');
    expect(ancestors).toContain('https://mochi.fast');
  });

  // A host or CI image exporting NODE_ENV=development must not open the allow-list on its own.
  test('NODE_ENV alone does not allow localhost', () => {
    expect(embedAncestors({ NODE_ENV: 'development' })).toEqual(['https://mochi.fast', 'https://www.mochi.fast']);
  });
});
