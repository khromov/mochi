// The dev outbox's attachment-download route serves attacker-controlled bytes
// (an app may relay a user-supplied file). It must only render known-inert types
// inline in the dev-server origin; HTML/SVG/anything else must download so a
// malicious attachment can't execute script against the dev origin.
import { afterEach, expect, test } from 'bun:test';
import type { ComponentRegistry } from './ComponentRegistry';
import { clearDevOutbox, recordDevEmail } from './email/devOutbox';
import type { EmailRuntime } from './email/config';
import type { MochiApiConfig } from './types';
import { buildEmailViewerRoutes } from './emailViewerRoutes';

const GLOBAL_KEY = '__mochi_email_runtime__';

// Seed the pinned runtime directly so we don't need a full Mochi.serve().
function seedRuntime(): void {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY] = {
    options: { transport: { type: 'dev' }, filterPii: false },
    outbox: [],
  } satisfies EmailRuntime;
}

afterEach(() => {
  clearDevOutbox();
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY];
});

function attachmentHandler() {
  const routes = buildEmailViewerRoutes({ assetPrefix: '/_mochi' } as unknown as ComponentRegistry);
  return (routes['/_mochi/email/attachment'] as MochiApiConfig).handler;
}

async function fetchAttachment(id: string, index: number): Promise<Response> {
  const handler = attachmentHandler();
  const url = new URL(`http://x/_mochi/email/attachment?id=${id}&index=${index}`);
  return (await handler({ url } as never)) as Response;
}

test('non-inert attachment types download instead of rendering inline', async () => {
  seedRuntime();
  const stored = recordDevEmail({
    from: 'a@b.dev',
    to: ['c@d.dev'],
    subject: 'x',
    attachments: [
      { filename: 'evil.html', content: '<script>alert(1)</script>', contentType: 'text/html' },
      { filename: 'logo.png', content: new Uint8Array([1, 2, 3]), contentType: 'image/png' },
      { filename: 'vector.svg', content: '<svg onload="alert(1)"></svg>', contentType: 'image/svg+xml' },
    ],
  });

  const html = await fetchAttachment(stored.id, 0);
  expect(html.headers.get('Content-Disposition')).toBe('attachment; filename="evil.html"');
  expect(html.headers.get('X-Content-Type-Options')).toBe('nosniff');

  const png = await fetchAttachment(stored.id, 1);
  expect(png.headers.get('Content-Disposition')).toBe('inline; filename="logo.png"');

  // SVG can carry script, so it downloads rather than rendering inline.
  const svg = await fetchAttachment(stored.id, 2);
  expect(svg.headers.get('Content-Disposition')).toBe('attachment; filename="vector.svg"');
});
