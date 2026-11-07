import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EMAIL_TEMPLATE_DIR, scanEmailTemplates } from './templates';

// Nothing here is compiled or imported, so a real temp dir is fine — the
// inside-the-project-tree rule only binds builds that emit SSR modules.
function scaffold(files: string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), 'mochi-email-scan-'));
  for (const f of files) {
    const abs = path.join(root, f);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, '<p>hi</p>');
  }
  return root;
}

describe('scanEmailTemplates', () => {
  test('returns nothing when the directory is absent, so existing apps are unaffected', () => {
    const root = scaffold(['src/Page.svelte']);
    try {
      expect(scanEmailTemplates(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('returns nothing when a plain file occupies the path, rather than aborting the build', () => {
    const root = scaffold([EMAIL_TEMPLATE_DIR]);
    try {
      expect(scanEmailTemplates(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('finds nested templates and ignores non-Svelte siblings', () => {
    const root = scaffold([
      `${EMAIL_TEMPLATE_DIR}/Welcome.svelte`,
      `${EMAIL_TEMPLATE_DIR}/receipts/Receipt.svelte`,
      `${EMAIL_TEMPLATE_DIR}/helpers.ts`,
      `${EMAIL_TEMPLATE_DIR}/theme.css`,
      'src/Page.svelte',
    ]);
    try {
      expect(scanEmailTemplates(root)).toEqual(['src/emails/Welcome.svelte', 'src/emails/receipts/Receipt.svelte']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('is sorted, so a rebuild of unchanged sources keeps entrypoint order stable', () => {
    const root = scaffold([`${EMAIL_TEMPLATE_DIR}/Zeta.svelte`, `${EMAIL_TEMPLATE_DIR}/alpha.svelte`, `${EMAIL_TEMPLATE_DIR}/Mid.svelte`]);
    try {
      expect(scanEmailTemplates(root)).toEqual(['src/emails/Mid.svelte', 'src/emails/Zeta.svelte', 'src/emails/alpha.svelte']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('yields forward-slash paths on every platform', () => {
    const root = scaffold([`${EMAIL_TEMPLATE_DIR}/receipts/Receipt.svelte`]);
    try {
      const found = scanEmailTemplates(root);
      expect(found).toEqual(['src/emails/receipts/Receipt.svelte']);
      expect(found.join('')).not.toContain('\\');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
