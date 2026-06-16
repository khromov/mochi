// Sample release data module — proves the changelog pipeline end to end and serves as the
// template the changelog-video skill copies per release. Keep each blurb short and each item
// brief so the total lands in 20-30s (this one is ~23s). To add a demo, set `demo` and mark
// the relevant item with `showDemo: true`.
import type { ChangelogRelease } from '../types';
import { BadgeRow, CodeChip, Stat } from '../visuals';

export const sampleRelease: ChangelogRelease = {
  version: 'v0.4.0',
  title: 'June release',
  introS: 4,
  outroS: 4,
  items: [
    {
      id: 'islands',
      title: 'Server Islands',
      blurb: 'Stream slow components in after the page paints.',
      durationS: 4.5,
      Visual: ({ t }) => <BadgeRow t={t} labels={['defer', 'visible', 'stream']} />,
    },
    {
      id: 'cache',
      title: 'One-line caching',
      blurb: 'Wrap any server function and serve it from cache.',
      durationS: 4.5,
      Visual: ({ t }) => <CodeChip t={t} text="Mochi.cache(loadPosts)" />,
    },
    {
      id: 'cold-start',
      title: 'Faster cold starts',
      blurb: 'Leaner bundles boot the server in a fraction of the time.',
      durationS: 4.5,
      Visual: ({ t }) => <Stat t={t} value={10} suffix="×" label="faster boot" />,
    },
    {
      id: 'batteries',
      title: 'Batteries included',
      blurb: 'Everything you reach for, in the box.',
      durationS: 4.5,
      Visual: ({ t }) => <BadgeRow t={t} labels={['Forms', 'WebSockets', 'SSE', 'Cookies']} />,
    },
  ],
};
