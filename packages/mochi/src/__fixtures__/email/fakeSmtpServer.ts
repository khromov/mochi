// Test SMTP server backed by `smtp-server` (the Nodemailer team's server-side
// counterpart to the `nodemailer` client). Plaintext only: AUTH/STARTTLS are
// disabled so nodemailer stays on `secure: false` and delivers without creds.
import { SMTPServer } from 'smtp-server';

export interface FakeSmtpMessage {
  from: string;
  to: string[];
  /** Raw DATA payload: headers + body, dot-unstuffed, CRLF line endings. */
  data: string;
}

export interface FakeSmtpServer {
  port: number;
  messages: FakeSmtpMessage[];
  close(): void;
}

export function startFakeSmtpServer(): FakeSmtpServer {
  const messages: FakeSmtpMessage[] = [];

  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['AUTH', 'STARTTLS'],
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        messages.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          to: session.envelope.rcptTo.map((r) => r.address),
          data: Buffer.concat(chunks).toString('utf8'),
        });
        callback();
      });
    },
  });

  server.listen(0, '127.0.0.1');
  const address = server.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('fake SMTP server did not bind to a TCP port');
  }

  return {
    port: address.port,
    messages,
    close: () => server.close(),
  };
}
