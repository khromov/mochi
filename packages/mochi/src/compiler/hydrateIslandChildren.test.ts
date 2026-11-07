import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry, formatCompileErrors, type MochiCompileError } from './ComponentRegistry';

describe('hydrate-island-children compile errors', () => {
  let fixtureDir: string;
  let outDir: string;
  let registry: ComponentRegistry;
  let pagePath: string;

  const BROKEN = `<script>\n  import Widget from './Widget.svelte';\n</script>\n<Widget mochi:hydrate><b>x</b></Widget>\n`;
  const FIXED = `<script>\n  import Widget from './Widget.svelte';\n</script>\n<Widget mochi:hydrate />\n`;

  beforeAll(async () => {
    fixtureDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-hydrate-children-fixture-'));
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-hydrate-children-'));
    registry = new ComponentRegistry({ development: true, outDir });
    pagePath = path.join(fixtureDir, 'Page.svelte');
    writeFileSync(path.join(fixtureDir, 'Widget.svelte'), '<p>widget</p>\n');
    writeFileSync(pagePath, BROKEN);
    await registry.compile(pagePath);
  });

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  test('children on a plain hydrate island record a hydrate-island-children error', () => {
    const errs = registry.getErrors().filter((e) => e.kind === 'hydrate-island-children');
    expect(errs).toEqual([{ kind: 'hydrate-island-children', component: 'Widget', directive: 'mochi:hydrate', filePath: pagePath }]);
  });

  test('a forced recompile (compile-cache hit) re-reports the error without duplicating it', async () => {
    await registry.compileAll([pagePath], { force: true });
    const errs = registry.getErrors().filter((e) => e.kind === 'hydrate-island-children');
    expect(errs).toHaveLength(1);
  });

  test('fixing the file clears the error on recompile', async () => {
    writeFileSync(pagePath, FIXED);
    await registry.compileAll([pagePath], { force: true });
    expect(registry.getErrors().filter((e) => e.kind === 'hydrate-island-children')).toHaveLength(0);
  });
});

describe('formatCompileErrors for hydrate-island children', () => {
  test('names the component, directive, file, and the fallback alternatives', () => {
    const errors: MochiCompileError[] = [
      { kind: 'hydrate-island-children', component: 'Wrapper', directive: 'mochi:hydrate:visible', filePath: path.resolve('src/pages/Index.svelte') },
    ];
    const msg = formatCompileErrors(errors);
    expect(msg).toContain('<Wrapper mochi:hydrate:visible>');
    expect(msg).toContain('src/pages/Index.svelte');
    expect(msg).toContain('cannot cross the server→client boundary');
    expect(msg).toContain('mochi:defer');
  });

  test('the displayed path never carries Windows backslashes', () => {
    const errors: MochiCompileError[] = [
      { kind: 'hydrate-island-children', component: 'Wrapper', directive: 'mochi:hydrate', filePath: path.join(process.cwd(), 'src\\pages\\Index.svelte') },
    ];
    expect(formatCompileErrors(errors)).not.toContain('\\');
  });
});
