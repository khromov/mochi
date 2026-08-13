import { isMochiPage, type MochiRouteValue } from '../types';
import type { SpeculationRules, SpeculationRuleCondition } from '../runtime/speculationRules';

/** URL globs excluded from speculation even when a page route matches (framework/API paths). */
const DEFAULT_EXCLUSIONS = ['/_*', '/api/*'];

/**
 * Convert a Bun router pattern to an `href_matches` glob: any segment that is a named param (`:slug`) or already
 * contains a wildcard collapses to a `*` segment. So `/blog/:slug` becomes `/blog` + `*`, and a static pattern is
 * returned unchanged.
 */
export function patternToGlob(pattern: string): string {
  return pattern
    .split('/')
    .map((seg) => (seg.startsWith(':') || seg.includes('*') ? '*' : seg))
    .join('/');
}

/** A route pattern with no dynamic segments — safe to enumerate or prerender. */
export function isStaticPattern(pattern: string): boolean {
  return !pattern.includes(':') && !pattern.includes('*');
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** Drop any glob already covered by a different wildcard glob (e.g. `/docs/changelog` under `/docs/*`), keeping first-seen order. */
export function collapseGlobs(globs: string[]): string[] {
  const wildcards = globs.filter((g) => g.includes('*'));
  return globs.filter((g) => !wildcards.some((w) => w !== g && globToRegExp(w).test(g)));
}

/** Apply the entry's trailing-slash policy to a concrete URL so generated matches align with the server. Root `/` is left alone. */
export function applyTrailingSlash(url: string, policy?: 'never' | 'always'): string {
  if (url === '/' || !policy) {
    return url;
  }
  const has = url.endsWith('/');
  if (policy === 'always' && !has) {
    return `${url}/`;
  }
  if (policy === 'never' && has) {
    return url.slice(0, -1);
  }
  return url;
}

export interface GenerateOptions {
  trailingSlash?: 'never' | 'always';
}

/** `not selector_matches` guards common to every generated rule — links the author has flagged not to speculate. */
const SELECTOR_EXCLUSIONS: SpeculationRuleCondition[] = [{ not: { selector_matches: '[target=_blank]' } }, { not: { selector_matches: '[rel~=nofollow]' } }];

function matchAny(globs: string[]): SpeculationRuleCondition {
  return globs.length === 1 ? { href_matches: globs[0]! } : { or: globs.map((g) => ({ href_matches: g })) };
}

/**
 * Build a starting-point Speculation Rules object from a route table: a broad `prefetch` document rule over every
 * page-route glob, and a conservative `prerender` rule limited to the static (non-dynamic) pages. Returns `{}` when
 * no page routes exist, so the caller can report there was nothing to generate.
 */
export function generateSpeculationRules(routes: Record<string, MochiRouteValue>, opts: GenerateOptions = {}): SpeculationRules {
  const pagePatterns = Object.entries(routes)
    .filter(([, handler]) => isMochiPage(handler))
    .map(([pattern]) => pattern);

  if (pagePatterns.length === 0) {
    return {};
  }

  // A concrete (wildcard-free) glob is a real URL the server canonicalizes, so align it with the trailing-slash policy.
  const normalize = (glob: string): string => (glob.includes('*') ? glob : applyTrailingSlash(glob, opts.trailingSlash));

  const globs = collapseGlobs([...new Set(pagePatterns.map(patternToGlob))]).map(normalize);
  const staticGlobs = [...new Set(pagePatterns.filter(isStaticPattern).map(normalize))];

  const excludeAnd: SpeculationRuleCondition[] = [...DEFAULT_EXCLUSIONS.map((g) => ({ not: { href_matches: g } }) as SpeculationRuleCondition), ...SELECTOR_EXCLUSIONS];

  const rules: SpeculationRules = {
    prefetch: [{ where: { and: [matchAny(globs), ...excludeAnd] }, eagerness: 'moderate' }],
  };

  // Prerender is resource-heavy, so keep it to the static pages a navigation is most likely to hit.
  if (staticGlobs.length > 0) {
    rules.prerender = [{ where: { and: [matchAny(staticGlobs), ...SELECTOR_EXCLUSIONS] }, eagerness: 'moderate' }];
  }

  return rules;
}
