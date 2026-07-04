import type { ComponentRegistry } from './ComponentRegistry';
import { clearDevOutbox, getDevEmail, getDevEmails, type StoredEmail } from './email/devOutbox';
import { redirect } from './forms';
import type { MochiPageConfig } from './types';

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

// Built as a `__mochiPage` literal rather than via `Mochi.page()` because
// Mochi.ts already imports from this module — going through the helper would
// create a circular import. Same dodge as `clientStatsRoutes.ts`.
export function buildEmailViewerRoutes(registry: ComponentRegistry): Record<string, MochiPageConfig> {
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
        selected,
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
  return {
    [path]: config,
    [`${path}/`]: config,
  };
}
