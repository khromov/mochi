import { isStandalone } from 'mochi-framework';

/**
 * A route link that works in both builds from the same component: the standalone app routes on the URL hash
 * (`#/todos/2`), while the Mochi.serve() web app uses real paths. The web app runs `trailingSlash: 'always'`, so the
 * path form gets a trailing slash to avoid a 308 redirect on each navigation.
 */
export function appHref(path: string): string {
  if (isStandalone) {
    return `#${path}`;
  }
  return path === '/' || path.endsWith('/') ? path : `${path}/`;
}
