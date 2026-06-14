// Demo plumbing shared by PageOne/PageTwo so the description and source-tab
// list aren't duplicated. Hidden from the displayed demo source by
// stripDemoWrapper, like the inline loadSources call it replaces.
import { loadSources } from '../../components/utils.ts';

export const description =
  'Bring your own animation to <ViewTransitions /> with custom={{ in, out }} — raw @keyframes bodies that drive the page you leave and the page you land on. Here the card does a funky 3D spin on every navigation.';

export const sources = await loadSources([
  { label: 'PageOne.svelte', path: './src/demos/custom-transitions/PageOne.svelte' },
  { label: 'PageTwo.svelte', path: './src/demos/custom-transitions/PageTwo.svelte' },
  { label: 'SpinCard.svelte', path: './src/demos/custom-transitions/SpinCard.svelte' },
  { label: 'shared.ts', path: './src/demos/custom-transitions/shared.ts' },
  { label: 'routes.ts', path: './src/demos/custom-transitions/routes.ts' },
  { label: 'index.ts', path: './src/demoIndex.ts' },
]);
