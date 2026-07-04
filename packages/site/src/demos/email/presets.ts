// The recipient is a fixed server-side constant — the demo never lets a visitor
// type an address, so no mail can be aimed at an arbitrary inbox.
export const DEMO_TO = 'Ada Lovelace <ada@example.com>';

export interface EmailPreset {
  id: string;
  label: string;
  subject: string;
  blurb: string;
}

export const EMAIL_PRESETS: EmailPreset[] = [
  {
    id: 'welcome',
    label: 'Welcome email',
    subject: 'Welcome to Mochi 🍡',
    blurb: 'A friendly onboarding note with a call-to-action button.',
  },
  {
    id: 'receipt',
    label: 'Order receipt',
    subject: 'Your receipt #1024',
    blurb: 'A transactional receipt with a small line-item table.',
  },
  {
    id: 'reset',
    label: 'Password reset',
    subject: 'Reset your password',
    blurb: 'A security email with a time-limited reset link.',
  },
];

export const presetById = (id: string): EmailPreset | undefined => EMAIL_PRESETS.find((p) => p.id === id);
