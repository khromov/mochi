export type TemplateId = 'minimal' | 'demos';

export interface Template {
  id: TemplateId;
  label: string;
  hint: string;
  /** Immutable `<owner>/<repo>/<subdir>#<commit>` URI. */
  source: string;
  /** SHA-256 of the complete GitHub codeload archive selected by `source`. */
  archiveSha256: string;
}

const TEMPLATE_REVISION = '13dc6cb80d459b587a8344e8f8bf6db231def8e7';
const TEMPLATE_ARCHIVE_SHA256 = '2ecead7ec976eecb24d5de95b339e489da1fccd4da8b43bcce578dc8bb5e078f';

export const TEMPLATES: readonly Template[] = [
  {
    id: 'minimal',
    label: 'Minimal',
    hint: 'a bare-bones Mochi app with a single page',
    source: `khromov/mochi/packages/minimal#${TEMPLATE_REVISION}`,
    archiveSha256: TEMPLATE_ARCHIVE_SHA256,
  },
  {
    id: 'demos',
    label: 'Demos',
    hint: 'a larger reference app with multiple demos (HN clone, todo, …)',
    source: `khromov/mochi/packages/demos#${TEMPLATE_REVISION}`,
    archiveSha256: TEMPLATE_ARCHIVE_SHA256,
  },
] as const;

export const TEMPLATE_IDS: readonly TemplateId[] = TEMPLATES.map((t) => t.id);

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
