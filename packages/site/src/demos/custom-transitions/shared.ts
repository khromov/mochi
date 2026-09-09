// Demo plumbing shared by PageOne/PageTwo so the description and source-tab
// list aren't duplicated. Hidden from the displayed demo source by
// stripDemoWrapper, like the sources.prerender.ts import it replaces.

export const description =
  'Bring your own animation to <ViewTransitions /> with custom={{ in, out }} — raw @keyframes bodies that drive the page you leave and the page you land on. Here the card does a funky 3D spin on every navigation.';

export { sources } from './sources.prerender.ts';
