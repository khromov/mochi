// Demo plumbing shared by PageOne/PageTwo so the description and source-tab
// list aren't duplicated. Hidden from the displayed demo source by
// stripDemoWrapper, like the inline loadSources call it replaces.
import { loadSources } from '../../components/utils.ts';
import { files } from './files.ts';

export const description =
  'Bring your own animation to <ViewTransitions /> with custom={{ in, out }} — raw @keyframes bodies that drive the page you leave and the page you land on. Here the card does a funky 3D spin on every navigation.';

export const sources = await loadSources(files);
