// Bun owns the real matcher, but it only reports the pattern for requests it
// matched — code that has to reason about a path Bun *didn't* match needs its own.
const PARAM_SEGMENT = /^:[^/]/;

/** Whether a concrete pathname matches a Bun route pattern (`/a/b`, `/a/:id`, `/a/*`). */
export function patternMatchesPath(pattern: string, pathname: string): boolean {
  if (pattern === pathname) {
    return true;
  }
  const patternSegments = pattern.split('/');
  const pathSegments = pathname.split('/');
  for (let i = 0; i < patternSegments.length; i++) {
    const segment = patternSegments[i]!;
    if (segment === '*') {
      return pathSegments.length > i;
    }
    const candidate = pathSegments[i];
    if (candidate === undefined) {
      return false;
    }
    if (candidate === segment) {
      continue;
    }
    if (!PARAM_SEGMENT.test(segment) || candidate === '') {
      return false;
    }
  }
  return patternSegments.length === pathSegments.length;
}
