import { isMochiPage, type MochiRouteValue } from '../types';
import { isWarmablePattern } from '../runtime/warmup';
import { isSlashExempt, trailingSlashIt, type TrailingSlashPolicy } from '../runtime/trailingSlash';
import type { SpeculationRules, SpeculationRuleCondition } from '../runtime/speculationRules';

/**
 * Whether route pattern `general` matches every URL `specific` does. `href_matches` is URL Pattern syntax, so a `:param`
 * segment spans exactly one path segment while `*` spans the rest — which is why `/blog/*` covers `/blog/:slug` but
 * `/blog/:slug` does not cover `/blog/*`, and `/blog/*` does not cover the bare `/blog`.
 */
function covers(general: string, specific: string): boolean {
  const g = general.split('/');
  const s = specific.split('/');
  for (let i = 0; i < g.length; i++) {
    const seg = g[i]!;
    if (seg.includes('*')) {
      return i < s.length;
    }
    if (i >= s.length) {
      return false;
    }
    if (seg.startsWith(':')) {
      if (s[i]!.includes('*')) {
        return false;
      }
      continue;
    }
    if (seg !== s[i]) {
      return false;
    }
  }
  return g.length === s.length;
}

/** Drop any pattern already covered by another (e.g. `/docs/changelog` under `/docs/*`), keeping first-seen order. */
export function collapsePatterns(patterns: string[]): string[] {
  // Two interchangeable patterns (`/blog/:slug` and `/blog/:id`) cover each other, so fall back to first-seen to keep one.
  return patterns.filter((p, i) => !patterns.some((other, j) => j !== i && covers(other, p) && (!covers(p, other) || j < i)));
}

/** Apply the entry's trailing-slash policy to a route pattern so generated matches align with what the server serves. */
export function applyTrailingSlash(pattern: string, policy?: TrailingSlashPolicy): string {
  if (!policy || isSlashExempt(pattern)) {
    return pattern;
  }
  if (policy === 'always') {
    return trailingSlashIt(pattern);
  }
  return pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
}

export interface GenerateOptions {
  trailingSlash?: TrailingSlashPolicy;
}

/** Guards applied to every generated rule: framework/API paths, and links the author has flagged not to speculate. */
const EXCLUSIONS: SpeculationRuleCondition[] = [
  { not: { href_matches: '/_*' } },
  { not: { href_matches: '/api/*' } },
  { not: { selector_matches: '[target=_blank]' } },
  { not: { selector_matches: '[rel~=nofollow]' } },
];

function matchAny(patterns: string[]): SpeculationRuleCondition {
  return patterns.length === 1 ? { href_matches: patterns[0]! } : { or: patterns.map((p) => ({ href_matches: p })) };
}

/**
 * Build a starting-point Speculation Rules object from a route table: a broad `prefetch` document rule over every
 * page-route pattern, and a conservative `prerender` rule limited to the static (non-dynamic) pages. Returns `{}` when
 * no page routes exist, so the caller can report there was nothing to generate.
 */
export function generateSpeculationRules(routes: Record<string, MochiRouteValue>, opts: GenerateOptions = {}): SpeculationRules {
  const pagePatterns = Object.entries(routes)
    .filter(([, handler]) => isMochiPage(handler))
    .map(([pattern]) => pattern);

  if (pagePatterns.length === 0) {
    return {};
  }

  // A `*` catch-all already spans any trailing slash; every other pattern ends at a URL the server canonicalizes.
  const normalize = (pattern: string): string => (pattern.includes('*') ? pattern : applyTrailingSlash(pattern, opts.trailingSlash));

  const patterns = collapsePatterns([...new Set(pagePatterns.map(normalize))]);
  const staticPatterns = [...new Set(pagePatterns.filter(isWarmablePattern).map(normalize))];

  const rules: SpeculationRules = {
    prefetch: [{ where: { and: [matchAny(patterns), ...EXCLUSIONS] }, eagerness: 'moderate' }],
  };

  // Prerender is resource-heavy, so keep it to the static pages a navigation is most likely to hit.
  if (staticPatterns.length > 0) {
    rules.prerender = [{ where: { and: [matchAny(staticPatterns), ...EXCLUSIONS] }, eagerness: 'moderate' }];
  }

  return rules;
}
