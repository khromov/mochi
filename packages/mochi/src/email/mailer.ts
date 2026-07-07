import { decode as decodeHtmlEntities } from 'html-entities';
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

/**
 * HTML → plain-text fallback so HTML mails stay multipart. Drops every tag,
 * suppresses the *contents* of <script>/<style> (css-inline emits a <style>
 * block into the rendered email HTML), inserts spaces around block-level tags so
 * adjacent blocks don't collide, surfaces each link's destination as
 * `text ( href )`, and decodes entities in a single pass via html-entities.
 * Bun's `text` chunks don't decode entities, so the decode runs last — which
 * also preserves escapes like `&amp;lt;` → `&lt;` (not `<`).
 */
export function htmlToText(html: string): string {
  let out = '';
  let skipDepth = 0;
  new HTMLRewriter()
    .on('script, style', {
      element(el) {
        skipDepth++;
        el.onEndTag(() => {
          skipDepth--;
        });
      },
    })
    .on('p, div, br, hr, li, tr, td, th, ul, ol, table, thead, tbody, blockquote, section, article, header, footer, h1, h2, h3, h4, h5, h6', {
      element() {
        out += ' ';
      },
    })
    .on('a', {
      element(el) {
        let href = el.getAttribute('href')?.trim();
        if (href && /^mailto:/i.test(href)) {
          href = href.slice('mailto:'.length).split('?')[0];
        }
        if (!href) {
          return;
        }
        const start = out.length;
        el.onEndTag(() => {
          // Angle brackets are the RFC-standard plain-text URL delimiter — mail
          // clients that auto-linkify stop at the `>`, so no padding is needed.
          if (href !== out.slice(start).trim()) {
            out += ` <${href}>`;
          }
        });
      },
    })
    .onDocument({
      text(chunk) {
        if (skipDepth === 0) {
          out += chunk.text;
        }
      },
    })
    .transform(html);
  return decodeHtmlEntities(out).replace(/\s+/g, ' ').trim();
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
