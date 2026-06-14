// Demo plumbing shared by PageOne/PageTwo so the description and source-tab
// list aren't duplicated. Hidden from the displayed demo source by
// stripDemoWrapper, like the inline loadSources call it replaces.
import { loadSources } from '../../components/utils.ts';

export interface Spin {
  key: string;
  label: string;
  // Raw keyframe bodies handed to <ViewTransitions custom={...} />; the
  // component wraps each into an @keyframes for us.
  out: string;
  in: string;
  easing: string;
}

// A non-empty tuple so SPINS[0] is a guaranteed default, not Spin | undefined.
export const SPINS: [Spin, ...Spin[]] = [
  {
    key: 'spin',
    label: 'spin',
    out: 'to { transform: rotate(540deg) scale(0); opacity: 0 }',
    in: 'from { transform: rotate(-540deg) scale(0); opacity: 0 }',
    easing: 'cubic-bezier(0.68, -0.55, 0.27, 1.55)',
  },
  {
    key: 'barrel',
    label: 'barrel roll',
    out: 'to { transform: perspective(1200px) rotateX(360deg) translateY(-60px); opacity: 0 }',
    in: 'from { transform: perspective(1200px) rotateX(-360deg) translateY(60px); opacity: 0 }',
    easing: 'cubic-bezier(0.7, 0, 0.3, 1)',
  },
  {
    key: 'corkscrew',
    label: 'corkscrew',
    out: 'to { transform: perspective(1200px) rotateY(360deg) rotate(90deg) scale(0.1); opacity: 0 }',
    in: 'from { transform: perspective(1200px) rotateY(-360deg) rotate(-90deg) scale(0.1); opacity: 0 }',
    easing: 'cubic-bezier(0.85, 0, 0.15, 1)',
  },
];

export function parseSpin(value: string | null): Spin {
  return SPINS.find((s) => s.key === value) ?? SPINS[0];
}

export const description =
  'Bring your own animation to <ViewTransitions /> with custom={{ in, out }} — raw @keyframes bodies that drive the page you leave and the page you land on. Here the card does a funky 3D spin on every navigation; pick a flavour below.';

export const sources = await loadSources([
  { label: 'PageOne.svelte', path: './src/demos/custom-transitions/PageOne.svelte' },
  { label: 'PageTwo.svelte', path: './src/demos/custom-transitions/PageTwo.svelte' },
  { label: 'SpinCard.svelte', path: './src/demos/custom-transitions/SpinCard.svelte' },
  { label: 'shared.ts', path: './src/demos/custom-transitions/shared.ts' },
  { label: 'routes.ts', path: './src/demos/custom-transitions/routes.ts' },
  { label: 'index.ts', path: './src/demoIndex.ts' },
]);
