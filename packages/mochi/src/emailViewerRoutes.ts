import type { ComponentRegistry } from './ComponentRegistry';
import { clearDevOutbox, getDevAttachment, getDevEmail, getDevEmails, type StoredEmail } from './email/devOutbox';
import { redirect } from './forms';
import type { MochiApiConfig, MochiPageConfig } from './types';

export const EMAIL_VIEWER_COMPONENT = Bun.fileURLToPath(new URL('./templates/EmailViewer/EmailViewer.svelte', import.meta.url));

/** Light list projection — full bodies are only sent for the selected message. */
export interface EmailListItem {
  id: string;
  sentAt: number;
  from: string;
  to: string[];
  subject: string;
  hasHtml: boolean;
  hasText: boolean;
  attachmentCount: number;
}

function toListItem(e: StoredEmail): EmailListItem {
  return {
    id: e.id,
    sentAt: e.sentAt,
    from: e.from,
    to: e.to,
    subject: e.subject,
    hasHtml: !!e.html,
    hasText: !!e.text,
    attachmentCount: e.attachments?.length ?? 0,
  };
}

/** Drop the raw attachment bytes before the message is serialized into the page — the viewer only needs metadata; the bytes are fetched on demand from the download route. */
function toClientEmail(e: StoredEmail): StoredEmail {
  if (!e.attachments) {
    return e;
  }
  return { ...e, attachments: e.attachments.map(({ filename, contentType, size }) => ({ filename, contentType, size })) };
}

// Built as a `__mochiPage` literal rather than via `Mochi.page()` because
// Mochi.ts already imports from this module — going through the helper would
// create a circular import. Same dodge as `clientStatsRoutes.ts`.
export function buildEmailViewerRoutes(registry: ComponentRegistry): Record<string, MochiPageConfig | MochiApiConfig> {
  const path = `${registry.assetPrefix}/email`;
  const config: MochiPageConfig = {
    __mochiPage: true,
    componentPath: EMAIL_VIEWER_COMPONENT,
    serverProps: (req) => {
      const id = new URL(req.url).searchParams.get('id');
      const emails = getDevEmails();
      const selected = id ? (getDevEmail(id) ?? null) : (emails[0] ?? null);
      return {
        emails: emails.map(toListItem),
        selected: selected ? toClientEmail(selected) : null,
        basePath: path,
      };
    },
    actions: {
      clear: () => {
        clearDevOutbox();
        return redirect(303, path);
      },
    },
  };
  // Streams one attachment's stored bytes so the viewer can open it in a new tab.
  // Dev-only (mounted behind the debug bar), so no auth beyond that gate.
  const attachment: MochiApiConfig = {
    __mochiApi: true,
    handler: ({ url }) => {
      const id = url.searchParams.get('id');
      const index = Number(url.searchParams.get('index'));
      const att = id && Number.isInteger(index) ? getDevAttachment(id, index) : undefined;
      if (!att || att.content === undefined) {
        return new Response('Attachment not found', { status: 404 });
      }
      const safeName = att.filename.replace(/["\r\n]/g, '');
      // Copy into a fresh view so the body is a concrete BodyInit (the stored
      // type widens to Uint8Array<ArrayBufferLike>, which Response rejects).
      const body: BodyInit = typeof att.content === 'string' ? att.content : new Uint8Array(att.content);
      const contentType = att.contentType || 'application/octet-stream';
      // An attachment's bytes and type are attacker-controlled when the app
      // relays a user-supplied file. Only render known-inert types inline (in the
      // dev-server origin); everything else — HTML, SVG, XML — downloads, so a
      // malicious attachment can't execute script against the dev origin. `nosniff`
      // stops the browser from second-guessing the declared type.
      const inlineSafe = /^(?:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon)|application\/pdf|text\/plain)\b/i.test(contentType);
      return new Response(body, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `${inlineSafe ? 'inline' : 'attachment'}; filename="${safeName}"`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        },
      });
    },
  };
  return {
    [path]: config,
    [`${path}/`]: config,
    [`${path}/attachment`]: attachment,
    [`${path}/attachment/`]: attachment,
  };
}
