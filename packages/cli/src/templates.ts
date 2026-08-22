export type TemplateId = 'minimal' | 'demos' | 'capacitor-ios-android';

export interface Template {
  id: TemplateId;
  label: string;
  hint: string;
  /**
   * `<owner>/<repo>/<subdir>` URI; resolves to the default branch, which can drift ahead of the
   * published `mochi-framework` version — append `#<ref>` for lockstep.
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
  {
    id: 'capacitor-ios-android',
    label: 'Capacitor (iOS/Android)',
    hint: 'a web app plus a Mochi.standalone() SPA build for packaging with Capacitor',
    source: 'khromov/mochi/packages/capacitor-ios-android',
  },
] as const;

export const TEMPLATE_IDS: readonly TemplateId[] = TEMPLATES.map((t) => t.id);

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
