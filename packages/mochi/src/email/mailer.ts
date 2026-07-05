import { mochiEvents } from '../events';
import { applyFilter } from '../extensions';
import { getEmailRuntime } from './config';
import { renderEmailComponent } from './render';
import { buildTransport } from './transports';
import { EmailError, type MochiEmailMessage, type MochiEmailResult, type ResolvedEmailMessage } from './types';

function toArray(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const list = (Array.isArray(value) ? value : [value]).map((a) => a.trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

/** Naive HTML → plain-text fallback so HTML mails stay multipart. */
function htmlToText(html: string): string {
  return (
    html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      // Only strip things that actually look like a tag — the name starts with a
      // letter, `/`, `!`, or `?`. A literal `a < b` in body text (no tag name
      // after `<`) is left intact instead of being swallowed as a bogus tag.
      .replace(/<\/?[a-zA-Z!?][^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      // Decode `&amp;` LAST: an escaped entity like `&amp;lt;` must resolve to the
      // literal text `&lt;`, not be double-decoded into `<`.
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Send one transactional message through the configured transport. With no
 * transport configured, the default `log` transport logs it and does not send.
 * Callable from any server-side code (route actions, API handlers, queue jobs).
 */
export async function sendEmail(message: MochiEmailMessage): Promise<MochiEmailResult> {
  const runtime = getEmailRuntime();
  const { options } = runtime;

  const from = message.from ?? options.from;
  if (!from) {
    throw new EmailError('No `from` address. Set a message `from` or configure `email.from` in Mochi.serve().');
  }

  const to = toArray(message.to);
  if (!to || to.length === 0) {
    throw new EmailError('An email needs at least one `to` recipient.');
  }

  let html = message.html;
  if (message.component) {
    if (!runtime.registry) {
      throw new EmailError('Rendering a Svelte email template requires a running Mochi.serve() (the component registry is not available).');
    }
    html = await renderEmailComponent(runtime.registry, message.component, message.props);
  }

  const text = message.text ?? (html ? htmlToText(html) : undefined);
  if (!html && !text) {
    throw new EmailError('An email needs a body: pass `html`, `text`, or `component`.');
  }

  const cc = toArray(message.cc);
  const bcc = toArray(message.bcc);
  const resolved: ResolvedEmailMessage = {
    from,
    to,
    ...(cc ? { cc } : {}),
    ...(bcc ? { bcc } : {}),
    ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    subject: message.subject,
    ...(html ? { html } : {}),
    ...(text ? { text } : {}),
    ...(message.attachments ? { attachments: message.attachments } : {}),
    ...(message.headers ? { headers: message.headers } : {}),
  };

  // Give application code a seam to rewrite the outgoing message (audit BCC,
  // List-Unsubscribe headers, staging catch-all) or veto it entirely by
  // returning null. Runs before the transport so the dev outbox and SMTP both
  // deliver the filtered message, and a veto never touches a transport.
  const start = performance.now();
  const filtered = await applyFilter('email:message', resolved, { transport: options.transport.type });
  if (filtered === null) {
    mochiEvents.emit('email:sent', {
      to: resolved.to,
      subject: resolved.subject,
      transport: 'suppressed',
      duration: performance.now() - start,
    });
    return { transport: 'suppressed' };
  }

  const transport = (runtime.transport ??= buildTransport(options.transport));
  try {
    const result = await transport.send(filtered);
    mochiEvents.emit('email:sent', {
      to: filtered.to,
      subject: filtered.subject,
      transport: result.transport,
      messageId: result.messageId,
      duration: performance.now() - start,
    });
    return result;
  } catch (error) {
    mochiEvents.emit('email:error', {
      to: filtered.to,
      ...(filtered.cc ? { cc: filtered.cc } : {}),
      ...(filtered.bcc ? { bcc: filtered.bcc } : {}),
      subject: filtered.subject,
      transport: transport.name,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
