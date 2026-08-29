// Mochi 0.8.0 release video data. Five headline features from the 0.8.0 blog post, mixing code
// chips with real UI screenshots (dev email outbox + captcha) in the brand green shell. Blurbs are
// one line each; durations picked so the total lands ~26s (inside the 20-30s changelog window).
import type { ChangelogRelease } from '../types';
import { CodeChip, Screenshot } from '../visuals';

export const release: ChangelogRelease = {
  version: 'v0.8.0',
  title: 'July release',
  audio: 'audio/Perfect_Sequence.mp3',
  introS: 3.5,
  outroS: 3.5,
  items: [
    {
      id: 'images',
      title: 'Image transforms',
      blurb: 'Resize, convert and cache — from imports or remote URLs.',
      durationS: 4.5,
      Visual: ({ t }) => <CodeChip t={t} text='<Image size="thumbnail" />' />,
    },
    {
      id: 'email',
      title: 'Transactional email',
      blurb: 'Send mail with Svelte components as templates.',
      durationS: 4.5,
      Visual: ({ t }) => <Screenshot t={t} src="images/email-outbox.png" width={1560} height={877} label="Built-in mail debugger" />,
    },
    {
      id: 'queues',
      title: 'Background queues',
      blurb: 'Defer slow work off the request path.',
      durationS: 4.5,
      Visual: ({ t }) => <CodeChip t={t} text="Mochi.queue({ concurrency: 10 })" />,
    },
    {
      id: 'captcha',
      title: 'Form captcha',
      blurb: 'Proof-of-work CAPTCHA — no third-party services.',
      durationS: 4.5,
      Visual: ({ t }) => <Screenshot t={t} src="images/captcha.png" width={1560} height={439} />,
    },
    {
      id: 'rate-limit',
      title: 'Rate limiting',
      blurb: 'Per-route limits, bans and a skip hook.',
      durationS: 4.5,
      Visual: ({ t }) => <CodeChip t={t} text="rateLimit: { limit: 100 }" />,
    },
  ],
};
