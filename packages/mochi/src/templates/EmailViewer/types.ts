// Shared prop types for the EmailViewer component tree. These re-export the
// canonical definitions rather than redeclaring them: StoredEmail/StoredAttachment
// are owned by the dev outbox, EmailListItem by the viewer's route projection.
export type { StoredAttachment, StoredEmail } from '../../email/devOutbox';
export type { EmailListItem } from '../../dev/emailViewerRoutes';
