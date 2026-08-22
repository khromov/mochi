// Shared by PageOne/PageTwo so the description and source-tab list aren't duplicated;
// stripDemoWrapper hides this file from the displayed demo source, like the inline loadSources call it replaces.
import { loadSources } from '../../components/utils.ts';
import { files } from './files.ts';

export const TRANSITIONS = ['fade', 'slide', 'scale', 'blur', 'flip'] as const;
export type TransitionType = (typeof TRANSITIONS)[number];

export function parseTransition(value: string | null): TransitionType {
  return TRANSITIONS.includes(value as TransitionType) ? (value as TransitionType) : 'fade';
}

export const description =
  "Add <ViewTransitions /> to a shared layout to animate full-page navigations via the browser's cross-document View Transitions API — no client router. The card animates while the video below is held still and keeps playing across the navigation, resuming at the same timestamp.";

export const sources = await loadSources(files);
