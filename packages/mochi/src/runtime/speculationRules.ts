/**
 * Speculation Rules API — the shape of a `<script type="speculationrules">` payload.
 * See https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API
 */

export type SpeculationEagerness = 'immediate' | 'eager' | 'moderate' | 'conservative';

/**
 * A boolean match condition for `source: 'document'` rules: leaf matchers
 * (`href_matches`, `selector_matches`) combine recursively via `and` / `or` / `not`.
 */
export type SpeculationRuleCondition =
  | { href_matches: string | string[] }
  | { selector_matches: string | string[] }
  | { and: SpeculationRuleCondition[] }
  | { or: SpeculationRuleCondition[] }
  | { not: SpeculationRuleCondition };

interface SpeculationRuleBase {
  eagerness?: SpeculationEagerness;
  /** Runtime requirements, e.g. `['anonymous-client-ip-when-cross-origin']`. */
  requires?: string[];
  referrer_policy?: string;
}

/** Explicit-URL rule; `source` is optional, inferred from the presence of `urls`. */
export interface SpeculationListRule extends SpeculationRuleBase {
  source?: 'list';
  urls: string[];
}

/** Link-matching rule; `source` is optional, inferred from the presence of `where`. */
export interface SpeculationDocumentRule extends SpeculationRuleBase {
  source?: 'document';
  where?: SpeculationRuleCondition;
}

export type SpeculationRule = SpeculationListRule | SpeculationDocumentRule;

export interface SpeculationRules {
  prefetch?: SpeculationRule[];
  prerender?: SpeculationRule[];
}
