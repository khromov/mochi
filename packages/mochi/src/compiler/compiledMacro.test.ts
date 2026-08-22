import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { transformCompiled } from './compiledMacro';
import { resetCompiledEvaluationCache } from './compiledTwin';

// The evaluated twin is imported from `<outDir>/compiled/`, so outDir has to sit inside the project tree or its
// `node_modules` chain never reaches back to the framework. Depth is '..','..' from src/compiler/.
let outDir: string;
let fixtures: string;

const CLOSE = `</${'script'}>`;

beforeAll(async () => {
  outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-compiled-macro-'));
  fixtures = path.join(outDir, 'fixtures');
  await Bun.write(
    path.join(fixtures, 'data.ts'),
    `export const items = ['a', 'b'];\nexport const load = (v: string[]) => v.map((s) => s.toUpperCase());\nexport const markup = () => '<div>${CLOSE}</div>';\n`,
  );
  await Bun.write(path.join(fixtures, 'side.ts'), `globalThis.__mochi_side__ = true;\n`);
});

afterAll(() => {
  resetCompiledEvaluationCache();
  rmSync(outDir, { recursive: true, force: true });
});

const svelteFile = () => path.join(fixtures, 'Component.svelte');

async function run(source: string, kind: 'svelte' | 'module' = 'svelte'): Promise<string> {
  return transformCompiled({ source, filePath: kind === 'svelte' ? svelteFile() : path.join(fixtures, 'mod.ts'), outDir, kind });
}

describe('transformCompiled', () => {
  test('leaves a file without the macro exactly as it was', async () => {
    const source = `<script>\n  const a = 1;\n${CLOSE}\n<p>{a}</p>`;
    expect(await run(source)).toBe(source);
  });

  test('inlines the resolved value and drops the enclosing await', async () => {
    const out = await run(
      `<script>\n  import { compiled } from 'mochi-framework';\n  import { items, load } from './data.ts';\n  const v = await compiled(() => load(items));\n${CLOSE}\n<p>{v}</p>`,
    );
    expect(out).toContain('const v = ["A","B"]');
    // The value is a literal now, so keeping `await` would force experimental.async on for nothing.
    expect(out).not.toContain('await');
    expect(out).not.toContain('./data.ts');
  });

  test('awaits an async compiled function', async () => {
    const out = await run(
      `<script>\n  import { compiled } from 'mochi-framework';\n  import { items } from './data.ts';\n  const v = await compiled(async () => { await Promise.resolve(); return items.length; });\n${CLOSE}`,
    );
    expect(out).toContain('const v = 2');
  });

  test('keeps an import the template still uses but drops one only the macro used', async () => {
    const out = await run(
      `<script>\n  import Child from './Child.svelte';\n  import { compiled } from 'mochi-framework';\n  import { items, load } from './data.ts';\n  const v = await compiled(() => load(items));\n${CLOSE}\n<Child {v} />`,
    );
    expect(out).toContain(`import Child from './Child.svelte'`);
    expect(out).not.toContain('./data.ts');
    expect(out).not.toContain('mochi-framework');
  });

  // The inlined payload is frequently source code itself, so a textual scan for `items` would match inside the
  // string literal and never prune anything. Reference counting has to be AST-based.
  test('prunes an import whose name also appears inside the inlined value', async () => {
    const out = await run(
      `<script>\n  import { compiled } from 'mochi-framework';\n  import { items } from './data.ts';\n  const v = await compiled(() => \`rendered source mentioning items: \${items.length}\`);\n${CLOSE}`,
    );
    expect(out).toContain('rendered source mentioning items: 2');
    expect(out).not.toContain('./data.ts');
  });

  test('never removes a bare side-effect import', async () => {
    const out = await run(
      `<script>\n  import './side.ts';\n  import { compiled } from 'mochi-framework';\n  import { items } from './data.ts';\n  const v = await compiled(() => items.length);\n${CLOSE}`,
    );
    expect(out).toContain(`import './side.ts'`);
  });

  test('keeps an import still used elsewhere in the script', async () => {
    const out = await run(
      `<script>\n  import { compiled } from 'mochi-framework';\n  import { items, load } from './data.ts';\n  const v = await compiled(() => load(items));\n  const n = items.length;\n${CLOSE}`,
    );
    expect(out).toContain(`import { items, load } from './data.ts'`);
  });

  test('escapes a value that would otherwise close the script tag', async () => {
    const out = await run(`<script>\n  import { compiled } from 'mochi-framework';\n  import { markup } from './data.ts';\n  const v = await compiled(() => markup());\n${CLOSE}`);
    // Exactly one script close: the real one.
    expect(out.split(CLOSE)).toHaveLength(2);
  });

  test('rejects a reference to a local binding, naming it', async () => {
    const local = `<script>\n  import { compiled } from 'mochi-framework';\n  const localThing = 2;\n  const v = await compiled(() => localThing + 1);\n${CLOSE}`;
    expect(run(local)).rejects.toThrow(/"localThing"/);
  });

  test('rejects importing a component into build-time code', async () => {
    const source = `<script>\n  import { compiled } from 'mochi-framework';\n  import Child from './Child.svelte';\n  const v = await compiled(() => Child);\n${CLOSE}`;
    expect(run(source)).rejects.toThrow(/moduleRef/);
  });

  test('ignores a compiled() that is not the framework import', async () => {
    const source = `<script>\n  import { compiled } from './local-helper.ts';\n  const v = compiled(() => 1);\n${CLOSE}`;
    expect(await run(source)).toBe(source);
  });

  test('allows globals without an import', async () => {
    const out = await run(`<script>\n  import { compiled } from 'mochi-framework';\n  const v = await compiled(() => JSON.stringify({ a: Math.min(2, 1) }));\n${CLOSE}`);
    expect(out).toContain('{\\"a\\":1}');
  });

  test('handles plain modules, including top-level await and multiple calls', async () => {
    const out = await run(
      `import { compiled } from 'mochi-framework';\nimport { items, load } from './data.ts';\nexport const a = await compiled(() => load(items));\nexport const b = await compiled(() => items.length);\n`,
      'module',
    );
    expect(out).toContain('export const a = ["A","B"]');
    expect(out).toContain('export const b = 2');
    expect(out).not.toContain('./data.ts');
    expect(out.startsWith('import')).toBe(false);
  });

  test('generates a real import for a module ref instead of serializing it', async () => {
    const out = await run(
      `import { compiled, moduleRef } from 'mochi-framework';\nexport const map = await compiled(() => ({ intro: moduleRef('./docs/intro.md') }));\n`,
      'module',
    );
    expect(out).toContain(`import __mochi_ref_0__ from "./docs/intro.md";`);
    expect(out).toContain('{intro:__mochi_ref_0__}');
  });

  test('reports each file it inlined calls in', async () => {
    const seen: { file: string; count: number }[] = [];
    await transformCompiled({
      source: `import { compiled } from 'mochi-framework';\nexport const a = await compiled(() => 1);\nexport const b = await compiled(() => 2);\n`,
      filePath: path.join(fixtures, 'usage.ts'),
      outDir,
      kind: 'module',
      onUsage: (u) => seen.push(u),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.count).toBe(2);
    expect(seen[0]!.file).toContain('usage.ts');
    expect(seen[0]!.file).not.toContain('\\');
  });
});
