// Exercises Mochi.email() end-to-end through a booted server: the default log
// transport (does not send), a custom-send transport, and the SMTP transport
// against a fake server. One Mochi.serve() per process (initMochiConfig allows
// only one), so the transport is swapped on the pinned runtime between tests.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from '../Mochi';
import { mochiEvents, type MochiEmailSentEvent } from '../events';
import { getEmailRuntime } from './config';
import { clearDevOutbox, getDevEmail, getDevEmails } from './devOutbox';
import type { MochiEmailTransportConfig, ResolvedEmailMessage } from './types';
import { startFakeSmtpServer, type FakeSmtpServer } from '../__fixtures__/email/fakeSmtpServer';

function useTransport(config: MochiEmailTransportConfig): void {
  const runtime = getEmailRuntime();
  runtime.options.transport = config;
  runtime.transport = undefined; // force a rebuild on next send
}

describe('Mochi.email()', () => {
  let server: Server<undefined>;
  let outDir: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-email-int-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {},
      email: { from: 'noreply@test.dev' },
    });
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('default (unconfigured) transport reports via event and does not send', async () => {
    useTransport({ type: 'log' });
    const sent: MochiEmailSentEvent[] = [];
    const onSent = (e: MochiEmailSentEvent) => sent.push(e);
    mochiEvents.on('email:sent', onSent);
    try {
      const result = await Mochi.email({ to: 'user@example.com', subject: 'Hi', html: '<p>Hello</p>' });
      expect(result.transport).toBe('log');
      expect(result.accepted).toEqual(['user@example.com']);
      // Delivery is reported only through the event (transport: 'log'); the log
      // transport performs no send.
      expect(sent).toHaveLength(1);
      expect(sent[0]?.transport).toBe('log');
    } finally {
      mochiEvents.off('email:sent', onSent);
    }
  });

  test('custom transport receives the fully resolved message', async () => {
    let captured: ResolvedEmailMessage | undefined;
    useTransport({
      type: 'custom',
      send: (msg) => {
        captured = msg;
        return { messageId: 'custom-1' };
      },
    });

    const result = await Mochi.email({
      to: 'user@example.com',
      subject: 'Welcome',
      html: '<p>Hi <b>there</b></p>',
    });

    expect(result).toEqual({ transport: 'custom', messageId: 'custom-1' });
    expect(captured).toBeDefined();
    expect(captured!.from).toBe('noreply@test.dev'); // filled from options
    expect(captured!.to).toEqual(['user@example.com']); // normalized to array
    expect(captured!.html).toBe('<p>Hi <b>there</b></p>');
    expect(captured!.text).toBe('Hi there'); // derived from html
  });

  test('derived plain-text keeps literal angle brackets and does not double-decode entities', async () => {
    let captured: ResolvedEmailMessage | undefined;
    useTransport({
      type: 'custom',
      send: (msg) => {
        captured = msg;
      },
    });

    // `a < b and c > d` is body text (not markup) and `&amp;lt;` is an escaped
    // entity that must survive as the literal `&lt;`.
    await Mochi.email({
      to: 'user@example.com',
      subject: 'Edge cases',
      html: '<p>if a < b and c > d — use &amp;lt;br&amp;gt; &amp; go</p>',
    });

    expect(captured!.text).toBe('if a < b and c > d — use &lt;br&gt; & go');
  });

  test('dev transport captures resolved messages into the in-memory outbox', async () => {
    useTransport({ type: 'dev' });
    clearDevOutbox();

    const result = await Mochi.email({
      to: 'first@example.com',
      cc: 'cc@example.com',
      subject: 'First',
      html: '<p>Hi <b>there</b></p>',
      headers: { 'X-Kind': 'test' },
    });

    expect(result.transport).toBe('dev');
    expect(result.accepted).toEqual(['first@example.com']);

    const emails = getDevEmails();
    expect(emails).toHaveLength(1);
    const stored = emails[0]!;
    expect(stored.from).toBe('noreply@test.dev'); // filled from options
    expect(stored.to).toEqual(['first@example.com']);
    expect(stored.cc).toEqual(['cc@example.com']);
    expect(stored.html).toBe('<p>Hi <b>there</b></p>');
    expect(stored.text).toBe('Hi there'); // derived from html
    expect(stored.headers).toEqual({ 'X-Kind': 'test' });
    expect(getDevEmail(stored.id)).toBe(stored);

    // A second send lands at the front (newest-first).
    await Mochi.email({ to: 'second@example.com', subject: 'Second', text: 'plain' });
    const after = getDevEmails();
    expect(after).toHaveLength(2);
    expect(after[0]?.subject).toBe('Second');
    expect(after[1]?.subject).toBe('First');

    clearDevOutbox();
    expect(getDevEmails()).toHaveLength(0);
  });

  test('SMTP transport delivers to a test server', async () => {
    const smtp: FakeSmtpServer = startFakeSmtpServer();
    useTransport({ type: 'smtp', host: '127.0.0.1', port: smtp.port, secure: false });
    try {
      const result = await Mochi.email({
        to: 'rcpt@example.com',
        from: 'sender@test.dev',
        subject: 'SMTP works',
        text: 'plain body',
      });

      expect(result.transport).toBe('smtp');
      expect(smtp.messages).toHaveLength(1);
      const msg = smtp.messages[0]!;
      expect(msg.from).toBe('sender@test.dev');
      expect(msg.to).toContain('rcpt@example.com');
      expect(msg.data).toContain('Subject: SMTP works');
      expect(msg.data).toContain('plain body');
    } finally {
      smtp.close();
    }
  });

  test('rejects a message with no recipient or no body', async () => {
    useTransport({ type: 'log' });
    await expect(Mochi.email({ to: '', subject: 'x', text: 'y' })).rejects.toThrow(/recipient/);
    await expect(Mochi.email({ to: 'a@b.dev', subject: 'x' })).rejects.toThrow(/body/);
  });
});
