/**
 * Shared client-side accessor for the set of unread dev-email ids. Written by the
 * debug bar (MochiDebugBar.svelte) and read by both the badge and the outbox list
 * item styling (templates/EmailViewer/MsgItem.svelte), so they stay in lockstep.
 */
export const UNREAD_EMAILS_KEY = 'mochi:debug:unread-emails';

export function loadUnreadEmailIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(UNREAD_EMAILS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
