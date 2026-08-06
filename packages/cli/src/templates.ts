export type TemplateId = 'minimal' | 'demos';

export interface Template {
  id: TemplateId;
  label: string;
  hint: string;
  /**
   * giget-core URI (`<owner>/<repo>/<subdir>`); resolves to the default branch, which can drift
   * ahead of the published `mochi-framework` version — append `#<tag>` for lockstep.
   */
  source: string;
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'minimal',
    label: 'Minimal',
    hint: 'a bare-bones Mochi app with a single page',
    source: 'khromov/mochi/packages/minimal',
  },
  {
    id: 'demos',
    label: 'Demos',
    hint: 'a larger reference app with multiple demos (HN clone, todo, …)',
    source: 'khromov/mochi/packages/demos',
  },
] as const;

export const TEMPLATE_IDS: readonly TemplateId[] = TEMPLATES.map((t) => t.id);

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
