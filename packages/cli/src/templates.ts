import pkg from '../package.json' with { type: 'json' };

export type TemplateId = 'minimal' | 'demos';

export interface Template {
  id: TemplateId;
  label: string;
  hint: string;
  /** Immutable `<owner>/<repo>/<subdir>#<tag>` URI. */
  source: string;
}

// release-please tags every create-mochi release `create-mochi-v<version>`, so deriving the ref from our own version
// pins each published CLI to the tree it shipped with — without a hand-written commit sha that nothing ever bumps.
export const TEMPLATE_REVISION = `create-mochi-v${pkg.version}`;

export const TEMPLATES: readonly Template[] = [
  {
    id: 'minimal',
    label: 'Minimal',
    hint: 'a bare-bones Mochi app with a single page',
    source: `khromov/mochi/packages/minimal#${TEMPLATE_REVISION}`,
  },
  {
    id: 'demos',
    label: 'Demos',
    hint: 'a larger reference app with multiple demos (HN clone, todo, …)',
    source: `khromov/mochi/packages/demos#${TEMPLATE_REVISION}`,
  },
] as const;

export const TEMPLATE_IDS: readonly TemplateId[] = TEMPLATES.map((t) => t.id);

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
