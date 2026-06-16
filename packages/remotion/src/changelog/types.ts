// Data shape for a changelog video. A release is a small TSX data module (see releases/)
// that the changelog-video skill writes per release; the reusable ChangelogVideo component
// renders it. Per-item visuals are React components so each item can animate however it needs.
import type { ComponentType } from 'react';

// Props every per-item Visual receives. `t` is seconds since the scene started; `p` is the
// scene's eased 0..1 progress. Drive animation from these — never CSS transitions.
export type VisualProps = { t: number; p: number };

export type ChangelogItem = {
  id: string;
  title: string;
  blurb: string;
  // Seconds this item holds on screen (default 3.5). Keep brief so the total lands in 20-30s.
  durationS?: number;
  // Optional bespoke visualization rendered in the scene's visual slot.
  Visual?: ComponentType<VisualProps>;
  // When set, this item's scene shows the demo video inside the green shell frame.
  showDemo?: boolean;
};

export type ChangelogDemo = {
  // Path under packages/remotion/public, referenced via staticFile() at render time.
  src: string;
  label?: string;
};

export type ChangelogRelease = {
  version: string;
  title: string;
  items: ChangelogItem[];
  demo?: ChangelogDemo;
  // Override default intro/outro hold (seconds).
  introS?: number;
  outroS?: number;
};
