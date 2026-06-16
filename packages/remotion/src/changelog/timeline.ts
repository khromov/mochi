// Lays the intro, each item, and the outro onto one continuous timeline where consecutive
// scenes overlap by FADE seconds, so they cross-fade exactly like the brand video's scenes
// (windowOpacity, same envelope). One source of truth for both ChangelogVideo and Root's
// calculateMetadata, so the composition duration always matches what actually renders.
import { FPS } from '../theme';
import type { ChangelogRelease } from './types';

export const FADE = 0.6; // cross-fade overlap between adjacent scenes, in seconds
const DEFAULT_ITEM_S = 3.5;
const DEFAULT_INTRO_S = 3;
const DEFAULT_OUTRO_S = 3;

export type SceneWindow = { start: number; end: number };

export type Timeline = {
  intro: SceneWindow;
  items: SceneWindow[];
  outro: SceneWindow;
  totalS: number;
  totalFrames: number;
};

export const computeTimeline = (release: ChangelogRelease): Timeline => {
  // Each scene starts FADE seconds before the previous ends, so adjacent scenes cross-fade.
  let cursor = 0;
  const place = (d: number): SceneWindow => {
    const w = { start: cursor, end: cursor + d };
    cursor = w.end - FADE;
    return w;
  };

  const intro = place(release.introS ?? DEFAULT_INTRO_S);
  const items = release.items.map((it) => place(it.durationS ?? DEFAULT_ITEM_S));
  const outro = place(release.outroS ?? DEFAULT_OUTRO_S);

  const totalS = outro.end;
  return { intro, items, outro, totalS, totalFrames: Math.ceil(totalS * FPS) };
};
