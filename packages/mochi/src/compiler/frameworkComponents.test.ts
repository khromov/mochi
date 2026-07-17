import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { resolveFrameworkComponent } from './frameworkComponents';

const BARREL_PATH = path.join(import.meta.dir, '..', 'components', 'index.ts');

// Every name the public barrel re-exports must resolve to a real file on disk,
// so the resolver and the barrel can never silently drift apart.
describe('resolveFrameworkComponent', () => {
  const barrelNames = [...fs.readFileSync(BARREL_PATH, 'utf8').matchAll(/export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)].flatMap(([, clause, spec]) =>
    /\.(svelte|md|svx)$/.test(spec!)
      ? clause!.split(',').map((b) =>
          b
            .trim()
            .split(/\s+as\s+/)
            .pop()!
            .trim(),
        )
      : [],
  );

  test('the barrel exports at least the known components', () => {
    expect(barrelNames).toContain('MochiCaptcha');
    expect(barrelNames.length).toBeGreaterThanOrEqual(3);
  });

  test.each(barrelNames)('%s resolves to an existing file', (name) => {
    const resolved = resolveFrameworkComponent(name);
    expect(resolved).not.toBeNull();
    expect(fs.existsSync(resolved!.resolvedPath)).toBe(true);
    expect(resolved!.resolvedPath).toMatch(/\.(svelte|md|svx)$/);
  });

  test('MochiCaptcha resolves to the captcha component via its default export', () => {
    const resolved = resolveFrameworkComponent('MochiCaptcha');
    expect(resolved?.exportName).toBe('default');
    expect(resolved?.resolvedPath.endsWith(path.join('captcha', 'MochiCaptcha.svelte'))).toBe(true);
  });

  test('an unknown export resolves to null', () => {
    expect(resolveFrameworkComponent('NotAComponent')).toBeNull();
  });
});
