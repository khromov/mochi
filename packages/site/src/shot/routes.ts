import { Mochi, error, getRequestContext } from 'mochi-framework';
import type { Handle, MochiRouteValue } from 'mochi-framework';
import { subjects, frameSize, fitScale, readScheme, SCHEMES } from './registry';

/**
 * Renders one component alone on a bare 16:9 canvas (1280x720 by default), with no
 * site chrome, for screenshotting. Size via `?w=`/`?h=`; see registry.ts for subjects.
 */
export const routes: Record<string, MochiRouteValue> = {
  '/shot/:name': Mochi.page('./src/shot/Shot.svelte', {
    serverProps: () => {
      const { params, url } = getRequestContext();
      const name = params.name ?? '';
      const subject = subjects[name];
      if (!subject) {
        error(404, `No shot subject '${name}'. Known: ${Object.keys(subjects).join(', ')}`);
      }
      if (!readScheme(url.searchParams)) {
        error(400, `No scheme '${url.searchParams.get('scheme')}'. Known: ${SCHEMES.join(', ')}`);
      }
      const frame = frameSize(url.searchParams);
      return { name, ...frame, natural: subject.natural, scale: fitScale(frame, subject.natural), props: subject.props(url) };
    },
  }),
};

/**
 * Pins the shot's colour scheme so a given URL yields the same image everywhere.
 * Without this the shell's `prefers-color-scheme` tokens leak the screenshotting
 * machine's OS theme into the canvas. Stamped on <html> because that's where the
 * shell declares its tokens, and the page component can't reach outside its own body.
 */
export const handle: Handle = async ({ event, resolve }) => {
  if (!event.url.pathname.startsWith('/shot/')) {
    return resolve(event);
  }
  const scheme = readScheme(event.url.searchParams) ?? 'light';
  return resolve(event, {
    transformPage: ({ html }) => html.replace('<html lang="en">', `<html lang="en" data-theme="${scheme}">`),
  });
};
