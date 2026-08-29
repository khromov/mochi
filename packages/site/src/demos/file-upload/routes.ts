import { Mochi, fail, success } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import FileUploadDemo from './FileUploadDemo.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/file-upload': Mochi.page(FileUploadDemo, {
    actions: {
      uploadFile: async ({ formData }) => {
        const file = formData.get('file');
        if (!(file instanceof File) || file.size === 0) {
          return fail(400, { error: 'No file selected' });
        }
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
        if (ext !== 'txt' && ext !== 'md') {
          return fail(400, { error: 'Only .txt and .md files are accepted' });
        }
        if (file.size > 100 * 1024) {
          return fail(400, { error: 'File too large (max 100 KB)' });
        }
        const content = await file.text();
        return success({ filename: file.name, content, size: file.size });
      },
    },
  }),
};
