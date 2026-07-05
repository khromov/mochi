import type { MochiEmailTransportConfig } from 'mochi-framework';

// Falls back to the dev outbox (/_mochi/email) when SMTP isn't configured yet,
// so the demo still boots and is testable before secrets are dropped into .env.
export function createSmtpTransport(): MochiEmailTransportConfig {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!user || !pass) {
    return { type: 'dev' };
  }
  return {
    type: 'smtp',
    host: process.env.SMTP_HOST || 'smtp.eu.mailgun.org',
    port: Number(process.env.SMTP_PORT) || 465,
    auth: { user, pass },
  };
}
