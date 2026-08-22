import type { SourceSpec } from '../../components/utils.ts';

export const files: SourceSpec[] = [
  { label: 'Email.svelte', path: './src/demos/email/Email.svelte' },
  { label: 'EmailForm.svelte', path: './src/demos/email/EmailForm.svelte' },
  { label: 'AttachmentForm.svelte', path: './src/demos/email/AttachmentForm.svelte' },
  { label: 'emails/PresetEmail.svelte', path: './src/emails/PresetEmail.svelte' },
  { label: 'emails/AttachmentEmail.svelte', path: './src/emails/AttachmentEmail.svelte' },
  { label: 'presets.ts', path: './src/demos/email/presets.ts' },
  { label: 'routes.ts', path: './src/demos/email/routes.ts' },
  { label: 'index.ts', path: './src/demoIndex.ts' },
];
