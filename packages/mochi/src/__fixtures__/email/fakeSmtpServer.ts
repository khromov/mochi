// Test SMTP server backed by `smtp-server` (the Nodemailer team's server-side
// counterpart to the `nodemailer` client). Plaintext only: STARTTLS is never offered,
// and AUTH only with `{ auth: true }` — what a STARTTLS-stripping attacker presents.
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
  /** `user:pass` of every AUTH the server received. */
  logins: string[];
  close(): void;
}

export function startFakeSmtpServer({ auth = false }: { auth?: boolean } = {}): FakeSmtpServer {
  const messages: FakeSmtpMessage[] = [];
  const logins: string[] = [];

  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: auth ? ['STARTTLS'] : ['AUTH', 'STARTTLS'],
    allowInsecureAuth: auth,
    onAuth(credentials, _session, callback) {
      logins.push(`${credentials.username}:${credentials.password}`);
      callback(null, { user: credentials.username });
    },
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
    logins,
    close: () => server.close(),
  };
}
