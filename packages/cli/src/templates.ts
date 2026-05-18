export type TemplateId = 'minimal' | 'demos';

export interface Template {
  id: TemplateId;
  label: string;
  hint: string;
  /**
   * giget-core URI: `<owner>/<repo>/<subdir>`.
   *
   * Resolves to the default branch (main), so the template files reflect
   * bleeding-edge mochi-framework — even though the generated `package.json`
   * pins the latest *published* `mochi-framework` from npm. Brief drift is
   * possible when main is ahead of the most recent release. Pin to a tag
   * (e.g. `khromov/mochi/packages/minimal#v0.2.0`) if you need lockstep.
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
